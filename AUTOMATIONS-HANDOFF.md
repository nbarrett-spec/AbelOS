# Aegis Order Automations — Claude Code Handoff

**Date:** 2026-04-27
**Author:** Cowork session (Nate Barrett)
**Status:** Architecture defined, ready for implementation
**Risk:** Medium — touches order PATCH route (critical path), automations page (existing UI), and new system config table. No schema migrations required for Phase 1.

---

## CRITICAL RULES

1. **Run `npx tsc --noEmit` after each phase** to verify zero type errors
2. **Do NOT break existing cascade behavior** — all current side effects must keep working
3. **Every new automation must have a kill switch** — either env var, DB toggle, or feature flag
4. **Commit after each numbered section** with message: `feat: automations #N — <short description>`
5. **Read the full file before editing** — cascade files are large and interconnected
6. **Test the order PATCH route after Phase 1** — it's the most critical path in the app

---

## Context: What exists today

### Order status flow (state machine)
```
RECEIVED → CONFIRMED → IN_PRODUCTION → READY_TO_SHIP → SHIPPED → DELIVERED → COMPLETE
                                                                                  ↓
Any non-terminal status ──────────────────────────────────────────────────→ CANCELLED
```

Transitions are enforced by `src/lib/status-guard.ts` via `requireValidTransition()`. Every order PATCH must pass the guard.

### Current automated side effects by status

| Status | What fires | File | Kill switch |
|--------|-----------|------|-------------|
| RECEIVED | Task: PM to review | `src/app/api/ops/orders/route.ts` L519 | None |
| CONFIRMED | Create Job + PM inbox + email builder | `src/lib/cascades/order-lifecycle.ts` | None |
| IN_PRODUCTION | Job cascade (idempotent no-op) | order-lifecycle.ts | None |
| READY_TO_SHIP | Create Delivery + ScheduleEntry + PM inbox | order PATCH route L238 + `delivery-lifecycle.ts` | None |
| SHIPPED | Email builder + stamp shippedAt | order PATCH route L207-210 | None |
| DELIVERED | Create Invoice (DRAFT) + paymentStatus=INVOICED + email builder + stamp deliveryConfirmedAt | order-lifecycle.ts | `Builder.autoInvoiceOnDelivery` (invoice only) |
| COMPLETE | Job → COMPLETE + ensure invoice exists | order-lifecycle.ts | None |
| CANCELLED | Audit log only | order PATCH route | None |

### The automation engine (exists but disconnected)

- **AutomationRule table** — stores user-defined rules with trigger, conditions, actions, frequency, enabled flag
- **AutomationLog table** — execution audit trail
- **Executor** (`src/lib/automation-executor.ts`) — processes rules, supports SEND_NOTIFICATION, SEND_EMAIL (deferred), CREATE_TASK, LOG_AUDIT, UPDATE_STATUS (deferred), plus 5 AI action types (deferred)
- **Cron** (`src/app/api/cron/run-automations/route.ts`) — runs hourly, checks time-based and polling triggers
- **UI** (`src/app/ops/automations/page.tsx`) — full CRUD for rules with 24 trigger types and 12 action types

**The critical gap:** The order PATCH route calls `runOrderStatusCascades()` directly but NEVER calls `fireAutomationEvent('ORDER_STATUS_CHANGED', ...)`. This means any automation rule created in the UI with an order-status trigger will never execute.

### Notification system

- `sendBuilderNotification()` in `src/lib/notifications.ts` — queues emails to `EmailQueue` table and creates `BuilderNotification` in-app records
- **Kill switch added 2026-04-27:** Email queueing is now gated on `BUILDER_INVOICE_EMAILS_ENABLED=true` (currently OFF)
- Builder notification functions: `notifyOrderConfirmed`, `notifyOrderShipped`, `notifyOrderDelivered`, `notifyInvoiceCreated`, `notifyInvoiceOverdue`, `notifyPaymentReceived`, `notifyQuoteReady`
- All called fire-and-forget from the order PATCH route

---

## Phase 1: Wire the automation engine to order flow

**Goal:** Make the existing automation engine fire on every order status change so user-defined rules actually work.

### 1.1 Add `fireAutomationEvent` call to order PATCH route

**File:** `src/app/api/ops/orders/[id]/route.ts`

**What to do:** After the existing `runOrderStatusCascades()` call (around line 223-228), add:

```typescript
import { fireAutomationEvent } from '@/lib/automation-executor'

// After runOrderStatusCascades() call:
// Fire the automation engine so user-defined rules execute
fireAutomationEvent('ORDER_STATUS_CHANGED', id, {
  orderId: id,
  orderNumber: updatedOrder.orderNumber,
  builderId: updatedOrder.builderId,
  from: currentStatus,
  to: newStatus,
  updatedBy: staffId,
}).catch(() => {})
```

**Important:** This must be fire-and-forget (`.catch(() => {})`). The automation engine failing must NEVER block an order status update.

**Also fire on order creation** — in `src/app/api/ops/orders/route.ts`, after the order INSERT succeeds (around line 515-520):

```typescript
fireAutomationEvent('ORDER_CREATED', newOrderId, {
  orderId: newOrderId,
  orderNumber,
  builderId,
  status: 'RECEIVED',
  createdBy: staffId,
}).catch(() => {})
```

### 1.2 Add `fireAutomationEvent` to delivery completion

**File:** `src/app/api/ops/delivery/[deliveryId]/complete/route.ts`

After the delivery status update (around line 121), add:

```typescript
fireAutomationEvent('DELIVERY_COMPLETE', deliveryId, {
  deliveryId,
  deliveryNumber,
  orderId,
  jobId,
  builderId,
  status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
}).catch(() => {})
```

### 1.3 Verify automation executor handles new context fields

**File:** `src/lib/automation-executor.ts`

The `evaluateConditions()` function (line 203) does simple key-value matching. Verify it can handle the context we're passing (it should — it's generic). No changes needed unless it fails on nested objects.

**Test:** Create an AutomationRule via the UI:
- Trigger: ORDER_STATUS_CHANGED
- Conditions: `{ "to": "CONFIRMED" }`
- Action: SEND_NOTIFICATION with payload `{ "staffId": "<nate's staff ID>", "title": "Order confirmed", "message": "Test automation fired" }`
- Then change an order to CONFIRMED and verify Nate gets a notification

---

## Phase 2: System Automations config table + toggle UI

**Goal:** Make hard-coded cascades (job creation, invoice creation, delivery creation, builder emails) toggleable from the automations page without code changes.

### 2.1 Create SystemAutomation config table

**No migration needed** — use a simple key-value config approach via the existing database.

Create a new table (or add to existing config):

```sql
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_system_automation_key" ON "SystemAutomation"("key");
```

Seed with the current hard-coded automations:

```sql
INSERT INTO "SystemAutomation" ("id", "key", "name", "description", "category", "triggerStatus", "enabled") VALUES
-- Order lifecycle
('sa_001', 'order.confirmed.create_job',       'Create Job on Order Confirm',          'Creates a Job row (JOB-YYYY-NNNN) linked to the order',                    'Order Lifecycle', 'CONFIRMED', true),
('sa_002', 'order.confirmed.pm_inbox',          'PM Inbox: Job Assignment',             'Creates an inbox item for PM to claim/schedule the job',                   'Order Lifecycle', 'CONFIRMED', true),
('sa_003', 'order.confirmed.email_builder',     'Email Builder: Order Confirmed',       'Sends confirmation email to builder contact',                              'Builder Emails',  'CONFIRMED', false),
('sa_004', 'order.ready.create_delivery',       'Create Delivery on Ready to Ship',     'Creates a Delivery record (DEL-YYYY-NNNN) with SCHEDULED status',          'Order Lifecycle', 'READY_TO_SHIP', true),
('sa_005', 'order.ready.schedule_entry',        'Create Calendar Entry',                'Creates a ScheduleEntry for the delivery date',                            'Order Lifecycle', 'READY_TO_SHIP', true),
('sa_006', 'order.shipped.email_builder',       'Email Builder: Order Shipped',         'Sends "your order has shipped" email to builder',                          'Builder Emails',  'SHIPPED', false),
('sa_007', 'order.delivered.create_invoice',     'Create Invoice on Delivery',           'Creates DRAFT invoice (INV-YYYY-NNNN) from order total',                   'Order Lifecycle', 'DELIVERED', true),
('sa_008', 'order.delivered.set_invoiced',       'Set Payment Status to INVOICED',       'Updates Order.paymentStatus to INVOICED',                                  'Order Lifecycle', 'DELIVERED', true),
('sa_009', 'order.delivered.email_builder',      'Email Builder: Order Delivered',       'Sends delivery confirmation email to builder',                             'Builder Emails',  'DELIVERED', false),
('sa_010', 'order.complete.advance_job',         'Advance Job to COMPLETE',              'Moves linked Job to COMPLETE status',                                      'Order Lifecycle', 'COMPLETE', true),
('sa_011', 'order.complete.ensure_invoice',      'Ensure Invoice Exists',                'Creates invoice if missing (backfill safety net)',                          'Order Lifecycle', 'COMPLETE', true),
-- Builder emails (currently all OFF via env var kill switch)
('sa_012', 'order.received.email_builder',       'Email Builder: Order Received',       'Sends acknowledgment email when order is received',                        'Builder Emails',  'RECEIVED', false),
('sa_013', 'order.complete.email_builder',       'Email Builder: Thank You',            'Sends thank-you email when order completes',                               'Builder Emails',  'COMPLETE', false),
('sa_014', 'order.cancelled.email_builder',      'Email Builder: Order Cancelled',      'Notifies builder their order was cancelled',                               'Builder Emails',  'CANCELLED', false),
-- Proposed new automations (all OFF by default)
('sa_015', 'order.confirmed.check_inventory',    'Check Inventory on Confirm',          'Flags backorders and material shortages immediately',                      'Inventory',       'CONFIRMED', false),
('sa_016', 'order.confirmed.generate_pick_list', 'Auto-Generate Pick List',             'Creates warehouse pick list from order items',                             'Warehouse',       'CONFIRMED', false),
('sa_017', 'order.production.sla_timer',         'Production SLA Timer',                'Alerts PM if order sits in IN_PRODUCTION longer than configured window',   'SLA',             'IN_PRODUCTION', false),
('sa_018', 'order.ready.notify_builder',         'Notify Builder: Delivery Scheduled',  'Sends delivery date/window to builder when order is ready to ship',        'Builder Emails',  'READY_TO_SHIP', false),
('sa_019', 'order.shipped.delivery_watchdog',    'Delivery Watchdog (24h)',             'Alerts ops if no delivery confirmation within 24h of ship',                'SLA',             'SHIPPED', false),
('sa_020', 'order.delivered.create_qc_task',     'Auto-Create QC Task',                 'Creates a QC inspection task for the delivered job',                        'Quality',         'DELIVERED', false),
('sa_021', 'order.cancelled.release_inventory',  'Release Reserved Inventory',          'Returns reserved materials to available stock on cancel',                   'Inventory',       'CANCELLED', false),
('sa_022', 'order.cancelled.void_draft_invoice', 'Void Draft Invoice on Cancel',        'Automatically voids any linked DRAFT invoice',                             'Finance',         'CANCELLED', false);
```

### 2.2 Create helper to check system automation state

**New file:** `src/lib/system-automations.ts`

```typescript
import { prisma } from '@/lib/prisma'

// Cache for 60 seconds to avoid hammering DB on every order update
let cache: Map<string, boolean> = new Map()
let cacheTime = 0
const CACHE_TTL = 60_000

export async function isSystemAutomationEnabled(key: string): Promise<boolean> {
  // Refresh cache if stale
  if (Date.now() - cacheTime > CACHE_TTL) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string; enabled: boolean }>>(
        `SELECT "key", "enabled" FROM "SystemAutomation"`
      )
      cache = new Map(rows.map(r => [r.key, r.enabled]))
      cacheTime = Date.now()
    } catch {
      // Table doesn't exist yet — default to true for existing cascades
      return true
    }
  }

  // If key not in table, default to true (backward compat for existing behavior)
  return cache.get(key) ?? true
}

export function invalidateSystemAutomationCache() {
  cacheTime = 0
}
```

### 2.3 Wire system automation checks into cascades

**File:** `src/lib/cascades/order-lifecycle.ts`

Wrap each cascade action in a toggle check. Example for `onOrderConfirmed`:

```typescript
import { isSystemAutomationEnabled } from '@/lib/system-automations'

export async function onOrderConfirmed(orderId: string): Promise<CascadeResult> {
  try {
    // ... existing order lookup code ...

    // Job creation — check toggle
    if (await isSystemAutomationEnabled('order.confirmed.create_job')) {
      // ... existing job creation code ...
    }

    // PM inbox — check toggle
    if (await isSystemAutomationEnabled('order.confirmed.pm_inbox')) {
      await safeInboxInsert({ ... })
    }

    return { ok: true, action: 'onOrderConfirmed', ... }
  } catch (e: any) { ... }
}
```

Apply the same pattern to:
- `onOrderDelivered` → wrap invoice creation in `order.delivered.create_invoice` check
- `onOrderDelivered` → wrap paymentStatus update in `order.delivered.set_invoiced` check
- `onOrderComplete` → wrap job advancement in `order.complete.advance_job` check
- `onOrderComplete` → wrap invoice backfill in `order.complete.ensure_invoice` check

**File:** `src/app/api/ops/orders/[id]/route.ts`

Wrap the email notification calls:

```typescript
import { isSystemAutomationEnabled } from '@/lib/system-automations'

// Around line 204-217, replace direct calls:
if (newStatus === 'CONFIRMED' && await isSystemAutomationEnabled('order.confirmed.email_builder')) {
  notifyOrderConfirmed(...).catch(() => {})
}
if (newStatus === 'SHIPPED' && await isSystemAutomationEnabled('order.shipped.email_builder')) {
  notifyOrderShipped(...).catch(() => {})
}
if (newStatus === 'DELIVERED' && await isSystemAutomationEnabled('order.delivered.email_builder')) {
  notifyOrderDelivered(...).catch(() => {})
}
```

Wrap delivery creation (around line 238):
```typescript
if (newStatus === 'READY_TO_SHIP' && await isSystemAutomationEnabled('order.ready.create_delivery')) {
  // existing delivery creation code
}
```

### 2.4 API routes for system automations

**New file:** `src/app/api/ops/system-automations/route.ts`

```typescript
// GET — list all system automations
// Returns: Array of SystemAutomation rows, grouped by category

// PATCH — toggle a system automation
// Body: { key: string, enabled: boolean }
// Auth: ADMIN or MANAGER only
// Must call invalidateSystemAutomationCache() after update
// Must write audit log: who toggled what, when
```

**New file:** `src/app/api/ops/system-automations/seed/route.ts`

```typescript
// POST — idempotent seed of SystemAutomation rows
// Only creates rows where key doesn't already exist
// Used for initial setup or adding new automations after deploy
// Auth: ADMIN only
```

### 2.5 Update automations page with System Automations section

**File:** `src/app/ops/automations/page.tsx`

Add a new tab or section at the TOP of the page called "System Automations" that:

1. Fetches from `GET /api/ops/system-automations`
2. Groups toggles by category (Order Lifecycle, Builder Emails, Inventory, Warehouse, SLA, Quality, Finance)
3. Each row shows: name, description, trigger status badge, enabled/disabled toggle switch
4. Toggle calls `PATCH /api/ops/system-automations` with `{ key, enabled }`
5. Shows a warning banner: "System automations control core platform behavior. Disabling a lifecycle automation may cause downstream features to break."
6. Builder Emails category should have a header note: "Builder-facing emails are currently OFF system-wide. Toggle individual emails here, then enable the master switch (BUILDER_INVOICE_EMAILS_ENABLED) in Vercel env vars when ready."

**Layout:**

```
┌──────────────────────────────────────────────────┐
│  Automations                                      │
│                                                   │
│  [System Automations] [Custom Rules] [Log]        │
│                                                   │
│  ── Order Lifecycle ─────────────────────────     │
│  ☑ Create Job on Order Confirm     CONFIRMED      │
│  ☑ PM Inbox: Job Assignment        CONFIRMED      │
│  ☑ Create Delivery on Ready        READY_TO_SHIP  │
│  ☑ Create Invoice on Delivery      DELIVERED      │
│  ...                                              │
│                                                   │
│  ── Builder Emails (master switch OFF) ─────      │
│  ☐ Email Builder: Order Received   RECEIVED       │
│  ☐ Email Builder: Order Confirmed  CONFIRMED      │
│  ☐ Email Builder: Order Shipped    SHIPPED        │
│  ...                                              │
│                                                   │
│  ── Proposed (not yet implemented) ─────────      │
│  ☐ Check Inventory on Confirm      CONFIRMED      │
│  ☐ Production SLA Timer            IN_PRODUCTION  │
│  ...                                              │
└──────────────────────────────────────────────────┘
```

---

## Phase 3: Staff notifications & task assignments per status change

**This is the primary purpose of the automation system.** Every order status change should notify the right internal people and create tasks for whoever needs to act next. Currently the only internal touch is a single PM InboxItem on CONFIRMED — everything else is a gap.

### Infrastructure: `notifyStaff()` helper

**New function in `src/lib/notifications.ts`:**

```typescript
/**
 * Send in-app notification to one or more staff members.
 * Uses the existing Notification table. Fire-and-forget.
 */
export async function notifyStaff(params: {
  staffIds: string[]          // one or more recipients
  type: string                // NotificationType enum value
  title: string
  body: string
  link?: string               // deep link into Aegis (e.g., /ops/orders/abc123)
}): Promise<void> {
  for (const staffId of params.staffIds) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "read", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2::"NotificationType", $3, $4, $5, false, NOW())`,
        staffId, params.type, params.title, params.body, params.link || null
      )
    } catch { /* best-effort */ }
  }
}
```

### Infrastructure: Role-based staff lookup helpers

**Add to `src/lib/notifications.ts` or a new `src/lib/staff-lookup.ts`:**

```typescript
/** Get staff IDs by role */
export async function getStaffByRole(role: string): Promise<string[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" WHERE "role"::text = $1 AND "isActive" = true`, role
  )
  return rows.map(r => r.id)
}

/** Get the assigned PM for a job (via Job.assignedPMId) */
export async function getAssignedPM(orderId: string): Promise<string | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT j."assignedPMId" FROM "Job" j WHERE j."orderId" = $1 AND j."assignedPMId" IS NOT NULL LIMIT 1`,
    orderId
  )
  return rows[0]?.assignedPMId || null
}

/** Get all managers (ADMIN + MANAGER roles) */
export async function getManagers(): Promise<string[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" WHERE "role"::text IN ('ADMIN', 'MANAGER') AND "isActive" = true`
  )
  return rows.map(r => r.id)
}
```

### 3.0 Staff notification + task matrix (what fires at each status)

This is the master table. Each row becomes a system automation toggle (add to the Phase 2 seed data). **All should be ON by default** except where noted.

| Status | Who | Action Type | What | Key |
|--------|-----|-------------|------|-----|
| **RECEIVED** | All PMs | Notification | "New order [ORD#] from [Builder] — $[total]. Review and confirm." | `order.received.notify_pms` |
| **RECEIVED** | Sales rep (order creator) | Task | "Review order [ORD#] — verify pricing, terms, delivery date" | `order.received.task_review` |
| **CONFIRMED** | Warehouse lead(s) | Notification | "Order [ORD#] confirmed — [X] items. Check stock and begin production." | `order.confirmed.notify_warehouse` |
| **CONFIRMED** | Accounting | Notification | "Order [ORD#] confirmed — $[total], terms [NET_15]. Expect invoice on delivery." | `order.confirmed.notify_accounting` |
| **CONFIRMED** | Assigned PM (via Job) | Task | "Schedule delivery for Job [JOB#] — [Builder], [address]" | `order.confirmed.task_schedule` |
| **IN_PRODUCTION** | Assigned PM | Notification | "Order [ORD#] is now in production. Estimated ready: [deliveryDate or TBD]." | `order.production.notify_pm` |
| **READY_TO_SHIP** | Logistics / Drivers | Notification | "Order [ORD#] ready for pickup/delivery — [itemCount] items, [address]" | `order.ready.notify_logistics` |
| **READY_TO_SHIP** | Assigned PM | Notification | "Order [ORD#] is ready to ship. Delivery [DEL#] created for [date]." | `order.ready.notify_pm` |
| **SHIPPED** | Assigned PM | Notification | "Order [ORD#] shipped. Confirm delivery within 24h." | `order.shipped.notify_pm` |
| **SHIPPED** | Ops managers | Notification (if high-value) | "High-value order [ORD#] ($[total]) shipped to [Builder]." Threshold: $5,000+ | `order.shipped.notify_mgr_highvalue` |
| **DELIVERED** | Accounting | Notification + Task | "Order [ORD#] delivered. Invoice [INV#] created as DRAFT — review and issue." | `order.delivered.notify_accounting` |
| **DELIVERED** | Assigned PM | Task | "Confirm delivery quality for Job [JOB#] — check for damage, shortages, builder sign-off" | `order.delivered.task_qc` |
| **COMPLETE** | Managers | Notification | "Order [ORD#] complete. Total: $[total]. Builder: [name]." | `order.complete.notify_mgr` |
| **COMPLETE** | Sales rep | Task (if no follow-up scheduled) | "Follow up with [Builder] — order [ORD#] complete. Schedule next touchpoint." | `order.complete.task_followup` |
| **CANCELLED** | Assigned PM | Notification | "Order [ORD#] cancelled. Job [JOB#] needs cleanup." | `order.cancelled.notify_pm` |
| **CANCELLED** | Accounting | Notification | "Order [ORD#] cancelled — void any DRAFT invoices." | `order.cancelled.notify_accounting` |
| **CANCELLED** | Warehouse | Notification | "Order [ORD#] cancelled — release any pulled/reserved materials." | `order.cancelled.notify_warehouse` |

### 3.1 Implementation: Wire notifications into cascades

**File:** `src/lib/cascades/order-lifecycle.ts`

**Pattern:** After each existing cascade action, add the notification calls. Example for `onOrderConfirmed`:

```typescript
import { notifyStaff, getStaffByRole, getAssignedPM } from '@/lib/notifications'
import { isSystemAutomationEnabled } from '@/lib/system-automations'

export async function onOrderConfirmed(orderId: string): Promise<CascadeResult> {
  // ... existing job creation code (unchanged) ...

  // ── Staff notifications (Phase 3) ──
  
  // Notify warehouse leads
  if (await isSystemAutomationEnabled('order.confirmed.notify_warehouse')) {
    const warehouseLeads = await getStaffByRole('WAREHOUSE_LEAD')
    if (warehouseLeads.length > 0) {
      const itemCount = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int AS cnt FROM "OrderItem" WHERE "orderId" = $1`, orderId
      )
      notifyStaff({
        staffIds: warehouseLeads,
        type: 'ORDER_UPDATE',
        title: `Order ${order.orderNumber} confirmed — ${itemCount[0]?.cnt || '?'} items`,
        body: `${order.builderName} order confirmed. Check stock and begin production.`,
        link: `/ops/orders/${orderId}`,
      }).catch(() => {})
    }
  }

  // Notify accounting
  if (await isSystemAutomationEnabled('order.confirmed.notify_accounting')) {
    const accounting = await getStaffByRole('ACCOUNTING')
    if (accounting.length > 0) {
      notifyStaff({
        staffIds: accounting,
        type: 'ORDER_UPDATE',
        title: `Order ${order.orderNumber} confirmed — expect invoice on delivery`,
        body: `${order.builderName}, $${Number(order.total || 0).toLocaleString()}. Invoice will auto-create on delivery.`,
        link: `/ops/orders/${orderId}`,
      }).catch(() => {})
    }
  }

  // Create task: PM schedule delivery
  if (await isSystemAutomationEnabled('order.confirmed.task_schedule')) {
    const pmId = await getAssignedPM(orderId)
    if (pmId) {
      const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Task" (id, "assigneeId", "creatorId", "jobId", title, description,
          priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById")
        VALUES ($1, $2, 'system', $3, $4, $5, 'HIGH', 'TODO', 'SCHEDULING',
          (NOW() + INTERVAL '2 days'), NOW(), NOW(), 'system')
      `, taskId, pmId, jobId,
        `Schedule delivery for Job ${jobNumber}`,
        `${order.builderName} — order ${order.orderNumber} confirmed. Coordinate delivery date and assign crew.`
      ).catch(() => {})
    }
  }

  return { ok: true, action: 'onOrderConfirmed', detail: 'job_created', jobId }
}
```

### 3.2 Implementation: Order PATCH route — status-based staff notifications

**File:** `src/app/api/ops/orders/[id]/route.ts`

Add a new function `fireStaffNotifications()` called after `runOrderStatusCascades()`:

```typescript
async function fireStaffNotifications(
  orderId: string,
  orderNumber: string,
  newStatus: string,
  builderId: string,
  builderName: string,
  total: number,
  staffId: string  // who made the change
): Promise<void> {
  try {
    const pmId = await getAssignedPM(orderId)

    switch (newStatus) {
      case 'RECEIVED': {
        if (await isSystemAutomationEnabled('order.received.notify_pms')) {
          const pms = await getStaffByRole('PROJECT_MANAGER')
          notifyStaff({
            staffIds: pms,
            type: 'ORDER_UPDATE',
            title: `New order ${orderNumber} from ${builderName}`,
            body: `$${total.toLocaleString()} — review and confirm.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        // Task: review order
        if (await isSystemAutomationEnabled('order.received.task_review')) {
          const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Task" (id, "assigneeId", "creatorId", "jobId", title, description,
              priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById")
            VALUES ($1, $2, 'system', NULL, $3, $4, 'HIGH', 'TODO', 'ORDER_REVIEW',
              (NOW() + INTERVAL '1 day'), NOW(), NOW(), 'system')
          `, taskId, staffId,  // assign to whoever created the order
            `Review order ${orderNumber} — verify pricing and terms`,
            `${builderName} — $${total.toLocaleString()}. Check pricing, payment terms, delivery date, and confirm.`
          ).catch(() => {})
        }
        break
      }

      case 'IN_PRODUCTION': {
        if (await isSystemAutomationEnabled('order.production.notify_pm') && pmId) {
          notifyStaff({
            staffIds: [pmId],
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} in production`,
            body: `${builderName} order is now being built.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        break
      }

      case 'READY_TO_SHIP': {
        // Notify logistics / drivers
        if (await isSystemAutomationEnabled('order.ready.notify_logistics')) {
          const drivers = await getStaffByRole('DRIVER')
          const warehouseLeads = await getStaffByRole('WAREHOUSE_LEAD')
          notifyStaff({
            staffIds: [...drivers, ...warehouseLeads],
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} ready for delivery`,
            body: `${builderName} — stage for pickup/delivery.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        // Notify PM
        if (await isSystemAutomationEnabled('order.ready.notify_pm') && pmId) {
          notifyStaff({
            staffIds: [pmId],
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} ready to ship`,
            body: `Delivery record created. Confirm schedule with ${builderName}.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        break
      }

      case 'SHIPPED': {
        // PM: confirm delivery
        if (await isSystemAutomationEnabled('order.shipped.notify_pm') && pmId) {
          notifyStaff({
            staffIds: [pmId],
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} shipped`,
            body: `Confirm delivery within 24h.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        // High-value alert to managers
        if (await isSystemAutomationEnabled('order.shipped.notify_mgr_highvalue') && total >= 5000) {
          const managers = await getManagers()
          notifyStaff({
            staffIds: managers,
            type: 'ORDER_UPDATE',
            title: `High-value order ${orderNumber} shipped — $${total.toLocaleString()}`,
            body: `${builderName}. Track delivery confirmation.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        break
      }

      case 'DELIVERED': {
        // Accounting: review and issue invoice
        if (await isSystemAutomationEnabled('order.delivered.notify_accounting')) {
          const accounting = await getStaffByRole('ACCOUNTING')
          if (accounting.length > 0) {
            notifyStaff({
              staffIds: accounting,
              type: 'INVOICE',
              title: `Order ${orderNumber} delivered — DRAFT invoice created`,
              body: `${builderName}, $${total.toLocaleString()}. Review and issue.`,
              link: `/ops/orders/${orderId}`,
            }).catch(() => {})
            // Create task for accounting
            const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
            await prisma.$executeRawUnsafe(`
              INSERT INTO "Task" (id, "assigneeId", "creatorId", "jobId", title, description,
                priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById")
              VALUES ($1, $2, 'system', NULL, $3, $4, 'HIGH', 'TODO', 'INVOICING',
                (NOW() + INTERVAL '1 day'), NOW(), NOW(), 'system')
            `, taskId, accounting[0],
              `Review and issue invoice for ${orderNumber}`,
              `${builderName} — $${total.toLocaleString()}. DRAFT invoice auto-created. Verify line items, then move to ISSUED.`
            ).catch(() => {})
          }
        }
        // PM: QC check
        if (await isSystemAutomationEnabled('order.delivered.task_qc') && pmId) {
          const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          const jobs: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id", "jobNumber" FROM "Job" WHERE "orderId" = $1 LIMIT 1`, orderId
          )
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Task" (id, "assigneeId", "creatorId", "jobId", title, description,
              priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById")
            VALUES ($1, $2, 'system', $3, $4, $5, 'MEDIUM', 'TODO', 'QC',
              (NOW() + INTERVAL '2 days'), NOW(), NOW(), 'system')
          `, taskId, pmId, jobs[0]?.id || null,
            `Delivery QC — ${orderNumber}`,
            `Confirm delivery quality for ${builderName}. Check for damage, shortages, and get builder sign-off.`
          ).catch(() => {})
        }
        break
      }

      case 'COMPLETE': {
        // Managers: order complete summary
        if (await isSystemAutomationEnabled('order.complete.notify_mgr')) {
          const managers = await getManagers()
          notifyStaff({
            staffIds: managers,
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} complete`,
            body: `${builderName} — $${total.toLocaleString()}.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        // Sales: follow-up task
        if (await isSystemAutomationEnabled('order.complete.task_followup')) {
          // Assign to order creator as proxy for sales rep
          const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          const salesStaff = await getStaffByRole('SALES_REP')
          const assignee = salesStaff[0] || staffId
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Task" (id, "assigneeId", "creatorId", "jobId", title, description,
              priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById")
            VALUES ($1, $2, 'system', NULL, $3, $4, 'LOW', 'TODO', 'FOLLOW_UP',
              (NOW() + INTERVAL '7 days'), NOW(), NOW(), 'system')
          `, taskId, assignee,
            `Follow up with ${builderName} after order ${orderNumber}`,
            `Order complete. Schedule next touchpoint — check satisfaction and upcoming project needs.`
          ).catch(() => {})
        }
        break
      }

      case 'CANCELLED': {
        // PM: cleanup
        if (await isSystemAutomationEnabled('order.cancelled.notify_pm') && pmId) {
          notifyStaff({
            staffIds: [pmId],
            type: 'ORDER_UPDATE',
            title: `Order ${orderNumber} cancelled`,
            body: `${builderName}. Clean up linked Job and materials.`,
            link: `/ops/orders/${orderId}`,
          }).catch(() => {})
        }
        // Accounting: void invoices
        if (await isSystemAutomationEnabled('order.cancelled.notify_accounting')) {
          const accounting = await getStaffByRole('ACCOUNTING')
          if (accounting.length > 0) {
            notifyStaff({
              staffIds: accounting,
              type: 'INVOICE',
              title: `Order ${orderNumber} cancelled — check for DRAFT invoices`,
              body: `${builderName}. Void any unpaid invoices linked to this order.`,
              link: `/ops/orders/${orderId}`,
            }).catch(() => {})
          }
        }
        // Warehouse: release materials
        if (await isSystemAutomationEnabled('order.cancelled.notify_warehouse')) {
          const warehouse = await getStaffByRole('WAREHOUSE_LEAD')
          if (warehouse.length > 0) {
            notifyStaff({
              staffIds: warehouse,
              type: 'ORDER_UPDATE',
              title: `Order ${orderNumber} cancelled — release materials`,
              body: `${builderName}. Return any pulled/reserved items to available stock.`,
              link: `/ops/orders/${orderId}`,
            }).catch(() => {})
          }
        }
        break
      }
    }
  } catch (e) {
    // Staff notifications are best-effort — never block order updates
    console.error('[fireStaffNotifications] error:', e)
  }
}
```

**Call site** — in the order PATCH handler, right after `runOrderStatusCascades()` and the existing `fireAutomationEvent()` call:

```typescript
// Fire staff notifications and task creation
if (newStatus) {
  fireStaffNotifications(
    id, orderRows[0].orderNumber, newStatus,
    orderRows[0].builderId, orderRows[0].builderName || 'Unknown',
    Number(orderRows[0].total || 0), staffId
  ).catch(() => {})
}
```

### 3.3 Updated SystemAutomation seed data (add these rows to Phase 2 seed)

Add to the Phase 2 SQL INSERT:

```sql
-- Staff notifications (all ON by default)
('sa_030', 'order.received.notify_pms',          'Notify PMs: New Order Received',       'All PMs get notified of new orders to review',                    'Staff Notifications', 'RECEIVED',       true),
('sa_031', 'order.received.task_review',          'Task: Review New Order',               'Creates review task for the order creator',                       'Staff Tasks',         'RECEIVED',       true),
('sa_032', 'order.confirmed.notify_warehouse',    'Notify Warehouse: Order Confirmed',    'Warehouse leads get stock check / production alert',              'Staff Notifications', 'CONFIRMED',      true),
('sa_033', 'order.confirmed.notify_accounting',   'Notify Accounting: Order Confirmed',   'Accounting gets heads-up on incoming invoice',                    'Staff Notifications', 'CONFIRMED',      true),
('sa_034', 'order.confirmed.task_schedule',        'Task: Schedule Delivery',              'PM gets task to schedule delivery for the confirmed job',         'Staff Tasks',         'CONFIRMED',      true),
('sa_035', 'order.production.notify_pm',           'Notify PM: In Production',             'PM knows their order is being built',                             'Staff Notifications', 'IN_PRODUCTION',  true),
('sa_036', 'order.ready.notify_logistics',         'Notify Logistics: Ready to Ship',      'Drivers + warehouse leads get staging notification',              'Staff Notifications', 'READY_TO_SHIP',  true),
('sa_037', 'order.ready.notify_pm',                'Notify PM: Ready to Ship',             'PM knows delivery record was created',                            'Staff Notifications', 'READY_TO_SHIP',  true),
('sa_038', 'order.shipped.notify_pm',              'Notify PM: Order Shipped',             'PM needs to confirm delivery within 24h',                         'Staff Notifications', 'SHIPPED',        true),
('sa_039', 'order.shipped.notify_mgr_highvalue',   'Notify Managers: High-Value Shipped',  'Managers alerted on orders $5K+ shipped',                         'Staff Notifications', 'SHIPPED',        true),
('sa_040', 'order.delivered.notify_accounting',     'Notify Accounting + Task: Invoice',   'Accounting gets notification + task to review/issue invoice',      'Staff Tasks',         'DELIVERED',      true),
('sa_041', 'order.delivered.task_qc',               'Task: Delivery QC Check',             'PM gets task to verify delivery quality and builder sign-off',     'Staff Tasks',         'DELIVERED',      true),
('sa_042', 'order.complete.notify_mgr',             'Notify Managers: Order Complete',      'Managers get summary of completed order',                         'Staff Notifications', 'COMPLETE',       true),
('sa_043', 'order.complete.task_followup',          'Task: Sales Follow-Up',               'Sales rep gets task to follow up with builder',                   'Staff Tasks',         'COMPLETE',       true),
('sa_044', 'order.cancelled.notify_pm',             'Notify PM: Order Cancelled',           'PM needs to clean up linked Job',                                'Staff Notifications', 'CANCELLED',      true),
('sa_045', 'order.cancelled.notify_accounting',     'Notify Accounting: Order Cancelled',   'Accounting voids any DRAFT invoices',                            'Staff Notifications', 'CANCELLED',      true),
('sa_046', 'order.cancelled.notify_warehouse',      'Notify Warehouse: Order Cancelled',    'Warehouse releases pulled/reserved materials',                   'Staff Notifications', 'CANCELLED',      true);
```

### 3.4 Update automations page layout (add Staff section)

The System Automations tab from Phase 2 should group these new rows into two new categories:

```
── Staff Notifications ────────────────────────
☑ Notify PMs: New Order Received        RECEIVED
☑ Notify Warehouse: Order Confirmed     CONFIRMED
☑ Notify Accounting: Order Confirmed    CONFIRMED
☑ Notify PM: In Production              IN_PRODUCTION
☑ Notify Logistics: Ready to Ship       READY_TO_SHIP
☑ Notify PM: Ready to Ship              READY_TO_SHIP
☑ Notify PM: Order Shipped              SHIPPED
☑ Notify Managers: High-Value Shipped   SHIPPED
☑ Notify Accounting + Task: Invoice     DELIVERED
☑ Notify Managers: Order Complete       COMPLETE
☑ Notify PM: Order Cancelled            CANCELLED
☑ Notify Accounting: Order Cancelled    CANCELLED
☑ Notify Warehouse: Order Cancelled     CANCELLED

── Staff Tasks ────────────────────────────────
☑ Task: Review New Order                RECEIVED
☑ Task: Schedule Delivery               CONFIRMED
☑ Task: Delivery QC Check               DELIVERED
☑ Task: Sales Follow-Up                 COMPLETE
```

---

## Phase 3B: Additional operational automations

These are supplementary automations. All should be OFF by default and toggleable from the UI.

### 3B.1 Order Received → Email builder acknowledgment

**Key:** `order.received.email_builder`
**Trigger:** ORDER_CREATED event (from Phase 1 wiring)

**Implementation:**
1. Add `notifyOrderReceived()` to `src/lib/notifications.ts`
2. Email content: "We've received your order #[number]. Our team is reviewing it and you'll receive a confirmation shortly."
3. Call from the order PATCH route when status is set (or from order creation route for new orders)
4. Gated by both `isSystemAutomationEnabled('order.received.email_builder')` AND `BUILDER_INVOICE_EMAILS_ENABLED=true`

### 3B.2 Order Confirmed → Check inventory availability

**Key:** `order.confirmed.check_inventory`
**Trigger:** `onOrderConfirmed` cascade

**Implementation:**
1. After job creation in `onOrderConfirmed`, query order items and check stock levels
2. For each item where `InventoryItem.onHand < OrderItem.quantity`:
   - Create InboxItem: "Backorder alert: [product] — need [qty], have [onHand]"
   - Priority: HIGH
3. If ANY items are short, create a summary InboxItem for the PM
4. Do NOT block the order — this is informational only

### 3B.3 Order Confirmed → Auto-generate pick list

**Key:** `order.confirmed.generate_pick_list`
**Trigger:** `onOrderConfirmed` cascade

**Implementation:**
1. Query OrderItems for the confirmed order
2. Create PickList record (or use existing model if one exists — check schema)
3. Each item becomes a PickListItem with: product, quantity, warehouse location (if tracked), pick status = PENDING
4. Create InboxItem for warehouse lead: "Pick list ready for Job [jobNumber]"

### 3B.4 In Production → SLA timer / stall detection

**Key:** `order.production.sla_timer`
**Trigger:** Cron-based (add to `run-automations` cron)

**Implementation:**
1. In the run-automations cron, add a new check function `checkProductionSLA()`:
   ```sql
   SELECT o."id", o."orderNumber", o."updatedAt",
          EXTRACT(EPOCH FROM (NOW() - o."updatedAt")) / 3600 AS "hoursInStatus"
   FROM "Order" o
   WHERE o."status"::text = 'IN_PRODUCTION'
     AND o."updatedAt" < NOW() - INTERVAL '48 hours'
   ```
2. For each stalled order, create InboxItem: "Order [number] has been in production for [X] hours — check status"
3. Priority: MEDIUM at 48h, HIGH at 72h
4. Idempotent: check for existing InboxItem before creating duplicate
5. The 48h threshold should be configurable — store in SystemAutomation.conditions JSON or a separate config

### 3B.5 Ready to Ship → Email builder delivery date

**Key:** `order.ready.notify_builder`
**Trigger:** When delivery is created (in order PATCH route or delivery-lifecycle cascade)

**Implementation:**
1. Add `notifyDeliveryScheduled()` to `src/lib/notifications.ts`
2. Email content: "Your order #[number] is ready and delivery is scheduled for [date]. We'll notify you when it's on its way."
3. Include delivery address, estimated time window if available
4. Gated by system automation toggle + builder email master switch

### 3B.6 Shipped → Delivery watchdog (24h)

**Key:** `order.shipped.delivery_watchdog`
**Trigger:** Cron-based (add to `run-automations` cron)

**Implementation:**
1. Add `checkDeliveryWatchdog()` to the cron:
   ```sql
   SELECT o."id", o."orderNumber", o."shippedAt"
   FROM "Order" o
   WHERE o."status"::text = 'SHIPPED'
     AND o."shippedAt" < NOW() - INTERVAL '24 hours'
   ```
2. For each, create InboxItem: "Order [number] shipped 24+ hours ago — no delivery confirmation. Check with driver."
3. Priority: HIGH
4. Idempotent via InboxItem dedup

### 3B.7 Cancelled → Auto-void DRAFT invoice + release inventory

**Key:** `order.cancelled.release_inventory` and `order.cancelled.void_draft_invoice`
**Trigger:** Order PATCH route when status → CANCELLED

**Implementation:**

**Void draft invoice:**
1. Query Invoice where `orderId = cancelledOrderId AND status = 'DRAFT'`
2. If found, update `Invoice.status = 'VOID'`
3. Log audit entry
4. Do NOT void invoices in ISSUED, SENT, or any non-DRAFT status — those need manual handling

**Inventory release:**
1. Query OrderItems for the cancelled order
2. For each item with a linked InventoryItem, increment `onHand` by the order quantity
3. Log the adjustment in an inventory audit trail
4. Only if items were previously reserved/decremented (check if a reservation system exists)

### 3B.8 Complete → Update builder metrics

**Key:** `order.complete.update_metrics` (add to seed)
**Trigger:** `onOrderComplete` cascade

**Implementation:**
1. After job completion, update BuilderIntelligence:
   - Increment `totalOrders`
   - Update `totalLifetimeValue` with order total
   - Recalculate `avgOrderValue`
   - Update `orderTrend` (GROWING/STABLE/DECLINING based on last 6 months)
2. If BuilderIntelligence row doesn't exist, create one
3. Fire-and-forget — metrics update failing should never block order completion

---

## Phase 4: Automations dashboard polish

### 4.1 Execution log improvements

The existing log tab on `/ops/automations` shows AutomationLog entries. Enhance:

1. Add system automation executions to the log (currently only custom rules log)
2. Add filters: by trigger type, by status (SUCCESS/ERROR), by date range
3. Add a "Recent Activity" summary at the top: "24 automations fired in last 24h, 2 errors"
4. Make rule names clickable → navigate to rule detail

### 4.2 Quick-create templates

Add a "Templates" section with pre-built automation rules users can install with one click:

- "Alert me when any order is cancelled" → ORDER_STATUS_CHANGED, condition: `{ "to": "CANCELLED" }`, action: SEND_NOTIFICATION
- "Create follow-up task when quote expires" → QUOTE_EXPIRED, action: CREATE_TASK
- "Notify ops when PO is overdue" → PO_OVERDUE, action: SEND_NOTIFICATION
- "Daily production stall report" → DAILY_MORNING, action: AI_ANALYZE (analyze orders stuck in production)

### 4.3 Role-based visibility

Currently all staff can see the automations page. Restrict:
- System Automations tab: ADMIN and MANAGER only
- Custom Rules: ADMIN, MANAGER, and ACCOUNTING (they need invoice/collections rules)
- Log: visible to all staff (read-only)

---

## Implementation order

| Phase | Scope | Estimated effort | Dependencies |
|-------|-------|-----------------|--------------|
| **Phase 1** — Wire automation engine | Small | ~1 hour | None |
| **Phase 2** — System automation toggles | Medium | ~3 hours | Phase 1 |
| **Phase 3** — Staff notifications + task assignments | Large | ~4 hours | Phase 2 |
| **Phase 3B** — Supplementary automations (inventory, SLA, watchdog) | Medium | ~3 hours | Phase 2 |
| **Phase 4** — Dashboard polish | Medium | ~2 hours | Phase 2 |

**Start with Phase 1.** It's the smallest change with the biggest impact — it makes the entire existing automation UI functional for order events. Phase 2 gives the toggle infrastructure. **Phase 3 is the most important phase** — it's what makes the system actually useful by notifying the right people and creating tasks when orders move. Phase 3B adds supplementary operational automations (inventory checks, SLA timers, etc.). Phase 4 is polish.

---

## Verification checklist

### Phase 1
- [ ] Create an AutomationRule in the UI with trigger ORDER_STATUS_CHANGED
- [ ] Change an order status → rule fires and notification appears
- [ ] Create an order → ORDER_CREATED event fires
- [ ] Complete a delivery → DELIVERY_COMPLETE event fires
- [ ] Automation failure does NOT block the order status update
- [ ] `npx tsc --noEmit` passes

### Phase 2
- [ ] `GET /api/ops/system-automations` returns all seeded rows
- [ ] `PATCH /api/ops/system-automations` toggles a row and audit logs it
- [ ] Disabling `order.confirmed.create_job` → confirming an order does NOT create a Job
- [ ] Re-enabling it → confirming an order creates a Job again
- [ ] Cache invalidates within 60 seconds of toggle
- [ ] Automations page shows System Automations tab with grouped toggles
- [ ] Only ADMIN/MANAGER can see System Automations tab

### Phase 3 — Staff notifications & tasks
- [ ] RECEIVED → all PMs get in-app notification
- [ ] RECEIVED → order creator gets "Review order" Task
- [ ] CONFIRMED → warehouse leads get notification
- [ ] CONFIRMED → accounting gets notification
- [ ] CONFIRMED → assigned PM gets "Schedule delivery" Task
- [ ] IN_PRODUCTION → PM gets notification
- [ ] READY_TO_SHIP → drivers + warehouse leads get notification
- [ ] READY_TO_SHIP → PM gets notification
- [ ] SHIPPED → PM gets notification
- [ ] SHIPPED → managers get notification for orders $5K+ (threshold works)
- [ ] DELIVERED → accounting gets notification + "Review invoice" Task
- [ ] DELIVERED → PM gets "Delivery QC" Task
- [ ] COMPLETE → managers get summary notification
- [ ] COMPLETE → sales rep gets "Follow up" Task
- [ ] CANCELLED → PM, accounting, warehouse all get notification
- [ ] All 17 staff automations toggleable on/off independently
- [ ] Disabling a toggle → that notification/task stops firing
- [ ] Tasks created with correct assignee, priority, category, and due date
- [ ] `notifyStaff()` helper works for single and multiple recipients
- [ ] Staff lookup helpers return only active staff

### Phase 3B — Supplementary automations
- [ ] Inventory check creates InboxItems for short items
- [ ] Production SLA cron fires for orders stalled >48h
- [ ] Delivery watchdog fires for orders shipped >24h with no delivery
- [ ] Cancel → DRAFT invoice voided, audit logged
- [ ] Cancel → inventory released (if reservation system exists)
- [ ] Builder metrics update on order completion

### Phase 4
- [ ] System automation executions appear in log
- [ ] Log filters work (trigger, status, date)
- [ ] Quick-create templates install correctly
- [ ] Role restrictions enforced on System Automations tab

---

## Files reference

| File | Role |
|------|------|
| `src/app/api/ops/orders/[id]/route.ts` | Order PATCH — status changes, cascades, notifications |
| `src/app/api/ops/orders/route.ts` | Order creation (POST) |
| `src/app/api/ops/delivery/[deliveryId]/complete/route.ts` | Delivery completion → order cascade |
| `src/lib/cascades/order-lifecycle.ts` | Hard-coded order status side effects |
| `src/lib/cascades/delivery-lifecycle.ts` | Delivery status side effects |
| `src/lib/automation-executor.ts` | User-defined automation rule processor |
| `src/app/api/cron/run-automations/route.ts` | Hourly automation cron |
| `src/lib/notifications.ts` | Builder email/notification hub |
| `src/lib/status-guard.ts` | State machine transition enforcement |
| `src/lib/state-machines.ts` | Transition definitions |
| `src/app/ops/automations/page.tsx` | Automations management UI |
| `src/lib/system-automations.ts` | **NEW** — system automation toggle helper |
| `src/app/api/ops/system-automations/route.ts` | **NEW** — system automation CRUD API |

---

## Commit messages

```
feat: automations #1 — wire fireAutomationEvent to order + delivery routes
feat: automations #2 — add SystemAutomation table, helper, and seed
feat: automations #2.3 — wrap cascades in system automation toggle checks
feat: automations #2.4 — system automations API routes (GET/PATCH/seed)
feat: automations #2.5 — add System Automations tab to automations page
feat: automations #3.0 — add notifyStaff helper + role-based staff lookups
feat: automations #3.1 — staff notifications for RECEIVED + CONFIRMED + IN_PRODUCTION
feat: automations #3.2 — staff notifications for READY_TO_SHIP + SHIPPED
feat: automations #3.3 — staff notifications + tasks for DELIVERED + COMPLETE
feat: automations #3.4 — staff notifications for CANCELLED (PM + accounting + warehouse)
feat: automations #3.5 — seed 17 staff notification/task toggles
feat: automations #3B.1 — builder acknowledgment email on received
feat: automations #3B.2 — inventory check on confirm
feat: automations #3B.3 — pick list generation on confirm
feat: automations #3B.4 — production SLA timer cron
feat: automations #3B.5 — builder delivery date notification
feat: automations #3B.6 — delivery watchdog (24h no-confirm alert)
feat: automations #3B.7 — void invoice + release inventory on cancel
feat: automations #3B.8 — update builder metrics on complete
feat: automations #4 — dashboard polish (log, templates, role gates)
```

---

## Phase 5: Job & Invoice Naming — Address-Based Identifiers

**Goal:** Replace the Bolt-style sequential numbering (`JOB-YYYY-NNNN`, `INV-YYYY-NNNN`) with human-readable identifiers based on the **house address + job type code**, matching the spec already documented in the Prisma schema at line 1140:

```
// Job number format: "<address> <type_code>" e.g. "10567 Boxthorn T1"
```

### Why this matters

The current `JOB-2026-0142` format is meaningless to PMs, drivers, and warehouse staff. Everyone internally refers to jobs by address: "the Boxthorn house" or "10567 Boxthorn trim 1." The system should match how people actually talk.

### 5.1 Job number format

**Format:** `<street_number> <street_name> <type_code>`

**Examples:**
- `10567 Boxthorn T1` (first trim at 10567 Boxthorn)
- `2204 Canyon Ridge DR` (door delivery at 2204 Canyon Ridge)
- `8831 Harvest Moon HW` (hardware at 8831 Harvest Moon)
- `1420 Silverleaf FF` (final front at 1420 Silverleaf)

**Type code mapping** (from `JobType` enum comments in schema):

| JobType | Code |
|---------|------|
| TRIM_1 | T1 |
| TRIM_1_INSTALL | T1I |
| TRIM_2 | T2 |
| TRIM_2_INSTALL | T2I |
| DOORS | DR |
| DOOR_INSTALL | DRI |
| HARDWARE | HW |
| HARDWARE_INSTALL | HWI |
| FINAL_FRONT | FF |
| FINAL_FRONT_INSTALL | FFI |
| QC_WALK | QC |
| PUNCH | PL |
| WARRANTY | WR |
| CUSTOM | CU |

### 5.2 Change `onOrderConfirmed()` in `order-lifecycle.ts`

**File:** `src/lib/cascades/order-lifecycle.ts`

**Current code (lines 52-60):**
```typescript
const year = new Date().getFullYear()
const maxRow: any[] = await prisma.$queryRawUnsafe(
  `SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
   FROM "Job" WHERE "jobNumber" LIKE $1`,
  `JOB-${year}-%`
)
const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
const jobNumber = `JOB-${year}-${String(nextNumber).padStart(4, '0')}`
```

**Replace with:**
```typescript
// Derive job number from address + type code per schema spec (line 1140)
// Format: "<street_number> <street_name> <type_code>" e.g. "10567 Boxthorn T1"

// Get address from the order's linked data — check Order items, or 
// the jobAddress/lotBlock/community fields that may be populated
const orderDetail: any[] = await prisma.$queryRawUnsafe(
  `SELECT o."id", o."poNumber", o."deliveryNotes",
          j_existing."jobAddress" AS "existingJobAddress"
   FROM "Order" o
   LEFT JOIN "Job" j_existing ON j_existing."orderId" = o."id"
   WHERE o."id" = $1`,
  orderId
)

// The Job row we're about to create will need jobAddress set.
// For now, derive from what we have. The PM will fill in the address
// on the Job record — this cascade sets a placeholder if missing.
const jobAddress: string | null = order.jobAddress || null
const jobTypeCode = 'T1' // Default to T1 (first trim); PM updates jobType later

function deriveJobNumber(address: string | null, typeCode: string): string {
  if (!address || address.trim().length === 0) {
    // Fallback: sequential if no address yet
    return null as any // signal to use fallback
  }
  // Parse: take street number + first word of street name
  // "10567 Boxthorn Lane" → "10567 Boxthorn"
  // "2204 Canyon Ridge Dr" → "2204 Canyon Ridge"  
  const parts = address.trim().split(/\s+/)
  if (parts.length < 2) return null as any
  
  const streetNumber = parts[0]
  // Take street name words (skip number, skip suffixes like Ln/Dr/St/Ave/Blvd/Ct/Way/Cir/Pl)
  const suffixes = new Set(['ln', 'dr', 'st', 'ave', 'blvd', 'ct', 'way', 'cir', 'pl', 'rd', 'lane', 'drive', 'street', 'avenue', 'boulevard', 'court', 'circle', 'place', 'road', 'pkwy', 'parkway', 'trl', 'trail'])
  const nameWords = parts.slice(1).filter(w => !suffixes.has(w.toLowerCase()))
  const streetName = nameWords.join(' ')
  
  if (!streetName) return null as any
  return `${streetNumber} ${streetName} ${typeCode}`
}

let jobNumber = deriveJobNumber(jobAddress, jobTypeCode)

if (!jobNumber) {
  // Fallback to sequential for orders without an address
  const year = new Date().getFullYear()
  const maxRow: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
     FROM "Job" WHERE "jobNumber" LIKE $1`,
    `JOB-${year}-%`
  )
  const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
  jobNumber = `JOB-${year}-${String(nextNumber).padStart(4, '0')}`
}

// Handle duplicate addresses (same house, multiple jobs): append suffix
const dupeCheck: any[] = await prisma.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS ct FROM "Job" WHERE "jobNumber" = $1`, jobNumber
)
if (dupeCheck[0]?.ct > 0) {
  // Already exists — this is a second job at the same address
  // Append a counter: "10567 Boxthorn T1-2"
  const countAtAddress: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS ct FROM "Job" WHERE "jobNumber" LIKE $1`,
    `${jobNumber}%`
  )
  jobNumber = `${jobNumber}-${(countAtAddress[0]?.ct || 1) + 1}`
}
```

**CRITICAL: The Order model does NOT have a `jobAddress` field.** The address must come from one of:
1. The `Job.jobAddress` field (but we're creating the Job, so it's not set yet)
2. The order's PO or delivery notes (parsed)
3. A new `jobAddress` field added to the Order model (RECOMMENDED — add `jobAddress String?` to the Order model)
4. The linked Community + lot info

**Recommended:** Add `jobAddress String?` to the `Order` model in `schema.prisma`. This is the cleanest path — when ops creates an order, they enter the job address. The cascade reads it. Migration: `ALTER TABLE "Order" ADD COLUMN "jobAddress" TEXT;`

### 5.3 Invoice naming — same pattern

**Current:** `INV-YYYY-NNNN` (sequential)
**New:** Mirror the job number: `<job_number> INV` → e.g. `10567 Boxthorn T1 INV`

**File:** `src/lib/cascades/order-lifecycle.ts`, `onOrderDelivered()` function

**Current code (lines 142-148):**
```typescript
const year = new Date().getFullYear()
const maxRow: any[] = await prisma.$queryRawUnsafe(
  `SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
   FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
  `INV-${year}-%`
)
const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`
```

**Replace with:**
```typescript
// Derive invoice number from linked job's number
const linkedJob: any[] = await prisma.$queryRawUnsafe(
  `SELECT "jobNumber" FROM "Job" WHERE "orderId" = $1 LIMIT 1`, orderId
)
let invoiceNumber: string
if (linkedJob.length > 0 && linkedJob[0].jobNumber && !linkedJob[0].jobNumber.startsWith('JOB-')) {
  // Address-based job number exists — derive invoice number
  invoiceNumber = `${linkedJob[0].jobNumber} INV`
} else {
  // Fallback to sequential
  const year = new Date().getFullYear()
  const maxRow: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
     FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
    `INV-${year}-%`
  )
  const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
  invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`
}

// Handle duplicate invoice numbers
const invDupeCheck: any[] = await prisma.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS ct FROM "Invoice" WHERE "invoiceNumber" = $1`, invoiceNumber
)
if (invDupeCheck[0]?.ct > 0) {
  const invCount: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS ct FROM "Invoice" WHERE "invoiceNumber" LIKE $1`,
    `${invoiceNumber}%`
  )
  invoiceNumber = `${invoiceNumber}-${(invCount[0]?.ct || 1) + 1}`
}
```

### 5.4 Schema migration

Add `jobAddress` to the Order model so it's captured at order creation time:

```sql
ALTER TABLE "Order" ADD COLUMN "jobAddress" TEXT;
```

Update `schema.prisma`:
```prisma
model Order {
  // ... existing fields ...
  jobAddress    String?       // House address for job naming
  // ... rest of fields ...
}
```

### 5.5 Update the order creation form

In the ops order creation UI, add a `jobAddress` text input. This is the source field that feeds the cascade. Without it, all jobs fall back to sequential numbering.

**File:** `src/app/ops/orders/new/page.tsx` (or wherever the order creation form lives)

### 5.6 Existing jobs — backfill (optional)

For existing jobs that already have `jobAddress` populated, a one-time backfill script can rename them:

```sql
-- Preview what job numbers would look like
SELECT j."id", j."jobNumber", j."jobAddress", j."jobType",
       CONCAT(
         SPLIT_PART(j."jobAddress", ' ', 1), ' ',
         SPLIT_PART(j."jobAddress", ' ', 2), ' ',
         COALESCE(
           CASE j."jobType"::text
             WHEN 'TRIM_1' THEN 'T1'
             WHEN 'DOORS' THEN 'DR'
             WHEN 'HARDWARE' THEN 'HW'
             ELSE 'T1'
           END, 'T1'
         )
       ) AS proposed_number
FROM "Job" j
WHERE j."jobAddress" IS NOT NULL AND j."jobAddress" != '';
```

**Do NOT auto-run the backfill.** Let Nate review the preview first.

### Verification checklist

- [ ] New orders with `jobAddress` produce job numbers like `10567 Boxthorn T1`
- [ ] New orders WITHOUT `jobAddress` fall back to `JOB-YYYY-NNNN`
- [ ] Invoice numbers derived from job: `10567 Boxthorn T1 INV`
- [ ] Duplicate addresses get suffixed: `10567 Boxthorn T1-2`
- [ ] `jobNumber` uniqueness constraint still passes
- [ ] `invoiceNumber` uniqueness constraint still passes
- [ ] Existing jobs are NOT renamed (manual backfill only)
- [ ] Order creation form has `jobAddress` field
- [ ] `npx tsc --noEmit` passes

### Commit messages

```
feat: automations #5.1 — add jobAddress to Order model + migration
feat: automations #5.2 — address-based job numbering in onOrderConfirmed
feat: automations #5.3 — address-based invoice numbering in onOrderDelivered
feat: automations #5.4 — add jobAddress field to order creation form
```
