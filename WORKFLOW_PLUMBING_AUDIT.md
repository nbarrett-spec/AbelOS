# Workflow Plumbing Audit — Abel OS (Aegis)

**Date:** 2026-04-22
**Scope:** Cross-entity cascade audit for Order, Job, PO, Invoice, Delivery, Payment lifecycles
**Repo commit:** `main` HEAD at audit time (3e6d2e8)
**Methodology:** Read every PATCH/POST handler that flips a status enum, trace its downstream side effects against the business spec in the mission statement. Compare against `src/lib/state-machines.ts` (the declarative transition map) and `src/lib/mrp.ts` (the only real cascade library).

---

## Executive summary

Abel OS has the **status enums and the transition map** (`src/lib/state-machines.ts`) defined correctly for all seven entity types. What it does **not** have is any code that **calls** `isValidTransition()`. The transition map is dead code — every mutation route writes the target status raw via `$executeRawUnsafe` with no validation. That's the first macro-finding.

The second macro-finding is **asymmetric cascades**. A few flows are fully plumbed (PO receive → inventory onHand + onOrder update; Delivery complete → Job advance to DELIVERED; installer complete → Job advance to COMPLETE/PUNCH_LIST). Most are not:

- **Order status PATCH writes the enum and sends a builder email** — nothing else. It does not create a Job, does not allocate inventory, does not create a Delivery, does not create an Invoice.
- **Invoice PATCH to ISSUED does not compute `dueDate`** from the payment term (only `issuedAt` is stamped).
- **No cron flips ISSUED/SENT invoices to OVERDUE**; `collections-cycle` only reads the overdue set, it does not update it. Only the `collections-email` cron flips SENT → OVERDUE, and only as a side-effect of sending an email, which means invoices never hit OVERDUE if email sending is off or if the builder has no email on file.
- **Job → COMPLETE does not auto-create an Invoice** despite the state machine (`COMPLETE → INVOICED`) implying it should.
- **Delivery COMPLETE does not auto-create an Invoice** despite "invoice on delivery" being Abel's standard practice.
- **Driver assignment** to a delivery happens through `/api/ops/delivery/dispatch` but has **no trigger** — nothing schedules a delivery when an Order hits `READY_TO_SHIP`. The only auto-create path for a Delivery row is a side-effect in `PATCH /api/ops/jobs/[id]` when the Job transitions into `LOADED/IN_TRANSIT/STAGED`, which means a Delivery only exists after the job is already loaded, contrary to the spec.
- **No Order → Job auto-create** from `POST /api/ops/orders` (the primary staff-facing creation path). The builder-facing `POST /api/orders` does auto-create a Job. Asymmetry is real.

Total missing cascades: **24** (see gap table). Top 10 ranked by business impact are called out at the end.

---

## How each transition is audited

For each transition I open (a) the PATCH/POST that triggers it, (b) the MRP/cascade library calls it makes, (c) any side-effect INSERTs it does, (d) whether it fires automation events, emits audit logs, or sends emails. "Should" rows are from the mission statement and `src/lib/state-machines.ts`. "Actual" rows are what the code does.

---

## 1. Order lifecycle (`RECEIVED → COMPLETE`)

**Status enum:** `RECEIVED, CONFIRMED, IN_PRODUCTION, AWAITING_MATERIAL, READY_TO_SHIP, PARTIAL_SHIPPED, SHIPPED, DELIVERED, COMPLETE, CANCELLED`

**Primary mutator:** `src/app/api/ops/orders/[id]/route.ts` (PATCH). Also: `src/app/api/ops/ai-orders/route.ts:514`, `src/app/api/ops/data-fix/route.ts:213` and `:506` (data-fix endpoints).

**What the PATCH actually does** (lines 98–210):
1. Raw SQL `UPDATE "Order" SET status = ...` with **no state-machine validation**.
2. If `status === 'SHIPPED'`, also stamps `shippedAt = NOW()`.
3. If `confirmDelivery` truthy, stamps `deliveryConfirmedAt = NOW()` and (if no status) forces `status = DELIVERED`.
4. Calls `audit(request, 'UPDATE', 'Order', id, {...})`.
5. Inserts a `BuilderNotification` row (wrapped in try/catch since the table may not exist).
6. Fires email via `notifyOrderConfirmed / notifyOrderShipped / notifyOrderDelivered` when the new status matches (fire-and-forget).

### 1.1 RECEIVED → CONFIRMED
| Aspect | Spec | Actual |
|---|---|---|
| Creates Job | Yes | **No.** Staff-facing `POST /api/ops/orders` creates the Order but never creates a Job. (Builder-facing `POST /api/orders` does — inconsistent.) |
| Allocates inventory (committed++) | Yes, decrement InventoryItem.available | **No.** Allocation only happens when a Job hits `MATERIALS_LOCKED` via `allocateJobMaterials()` in `src/lib/mrp.ts:457`. No Job = no allocation. |
| Audit | Yes | Yes |
| RBAC | Yes | Only `checkStaffAuth` — any authenticated staff member can flip any order to any status |

### 1.2 CONFIRMED → IN_PRODUCTION
| Aspect | Spec | Actual |
|---|---|---|
| Auto-generate picks | Yes | **No.** Picks only generated via explicit `POST /api/ops/manufacturing/generate-picks` (manual). |
| Advance Job to IN_PRODUCTION | Yes | **No.** Order and Job statuses drift independently. |
| Set `pickListGenerated = true` | Yes | Only set by `generate-picks` route (line 200). No auto-trigger from Order status change. |

### 1.3 IN_PRODUCTION → READY_TO_SHIP
| Aspect | Spec | Actual |
|---|---|---|
| QC gate enforcement | Yes | **No gate.** `QualityCheck` rows can be created via `POST /api/ops/manufacturing/qc`, but nothing blocks an Order from moving to `READY_TO_SHIP` if QC has not passed. The QC POST handler does not advance Job status on PASS, and the Order PATCH does not check for PASS. |

### 1.4 READY_TO_SHIP → SHIPPED
| Aspect | Spec | Actual |
|---|---|---|
| Create Delivery row | Yes, on READY_TO_SHIP | **No.** Delivery auto-create only fires on `PATCH /api/ops/jobs/[id]` when Job moves to `LOADED/IN_TRANSIT/STAGED` (lines 204–231), which is downstream of SHIPPED. |
| Assign crew/driver | Yes | **No auto-assign.** Assignment requires a manual call to `POST /api/ops/delivery/dispatch` with action `ASSIGN_CREW` or `AUTO` (lines 158–235). |
| Schedule (date) | Yes | Order.deliveryDate is separate from ScheduleEntry. No ScheduleEntry row is created. |

### 1.5 SHIPPED → DELIVERED
| Aspect | Spec | Actual |
|---|---|---|
| Create Invoice | Yes (non-labor orders) | **No.** Only by explicit `POST /api/ops/invoices/from-order` — never triggered by the Order PATCH. |
| Mark Job delivered | Yes | Partial — `PATCH /api/ops/orders/[id]` does not touch Job. The reverse path exists: `POST /api/ops/delivery/[deliveryId]/complete` (line 111) does advance Job to `DELIVERED` when the Delivery completes. |
| Notify builder | Yes | Yes — `notifyOrderDelivered()` called on line 189. |

### 1.6 DELIVERED → COMPLETE
| Aspect | Spec | Actual |
|---|---|---|
| Close Job | Yes | **No.** Order PATCH does not advance Job. |
| Trigger warranty clock | Yes | **No.** No `warrantyStartsAt` or `warrantyExpiresAt` set anywhere. |
| Prompt feedback | Yes | **No.** `src/app/api/deliveries/feedback/route.ts` accepts feedback but nothing prompts for it. |

---

## 2. Purchase Order lifecycle

**Status enum:** `DRAFT, PENDING_APPROVAL, APPROVED, SENT_TO_VENDOR, PARTIALLY_RECEIVED, RECEIVED, CANCELLED`

**Primary mutators:**
- `src/app/api/ops/purchasing/route.ts` PATCH (line 300): naked status flip, no side effects beyond audit.
- `src/app/api/ops/procurement/purchase-orders/[id]/route.ts` PATCH (line 45): action-based dispatcher — has `approve`, `send`, `receive`, `mark_paid`, `cancel`, `in_transit`.
- `src/app/api/ops/manufacturing-command/receiving/route.ts` PATCH (line 190): `mark_received` and `mark_partial`.

### 2.1 DRAFT → PENDING_APPROVAL → APPROVED → SENT_TO_VENDOR
| Aspect | Spec | Actual |
|---|---|---|
| Bump `InventoryItem.onOrder` | On DRAFT creation | **Yes** — done at PO creation in `src/app/api/ops/purchasing/route.ts:244-265`. This is the earlier fix that landed. |
| Email PO to vendor | On SENT_TO_VENDOR | **No.** The `action: 'send'` branch (procurement route, lines 69–77) only flips status. No email call, no CommunicationLog entry. `grep -r "sendEmail.*vendor"` returns zero matches. |
| CommunicationLog entry | On send | **No.** The CommunicationLog table reference exists in codebase but no write happens when a PO is sent. |
| `defaultExpectedDateForPO()` called on SENT | Yes (exists in `src/lib/mrp.ts:417`) | **No caller** — the helper exists, but neither `/purchasing` PATCH nor `/procurement/.../route.ts` action `send` invokes it. |
| Fire automation event | Yes | `PO_APPROVED` fires on approve (line 63). `send` does NOT fire an event. |

### 2.2 SENT_TO_VENDOR → PARTIALLY_RECEIVED / RECEIVED
Two code paths exist and behave differently:

| Path | What happens on receive |
|---|---|
| `/api/ops/procurement/purchase-orders/[id]/route.ts` action=`receive` (line 91) | Bumps `InventoryItem.onHand += qty`, `onOrder = GREATEST(onOrder - qty, 0)`, recalculates `available`, `daysOfSupply`, `status` (LOW_STOCK / CRITICAL / etc.), stamps `lastReceivedAt`. Fires `PO_RECEIVED` automation if fully received. Good. |
| `/api/ops/manufacturing-command/receiving/route.ts` action=`mark_received` (line 212) | Bumps `onHand` only. **Does not decrement `onOrder`.** Does not recalculate `available`, `daysOfSupply`, or `status`. No automation event. |

**Severity: HIGH.** Two receiving routes with different behavior means whichever UI ops uses will determine whether `onOrder` gets fixed or drifts. On the legacy/mfg-command receiving UI, `onOrder` will grow forever.

### 2.3 RECEIVED → AP due-date tracking
| Aspect | Spec | Actual |
|---|---|---|
| AP due-date tracking | Yes | **Partial.** `action: 'mark_paid'` (line 166) writes a text note into PO.notes and stamps `receivedAt` if missing. No BillPayment / AP model exists — comment at line 164 says "Full BillPayment model planned for Phase 2." So AP is not actually tracked. |

### 2.4 General PATCH (`/api/ops/purchasing`, PATCH)
This endpoint (line 300) is a naked status flip with audit. It does **not**: validate transitions, bump inventory, send emails, default expected date, or fire automations. It's a lower-fidelity version of the procurement route. If any UI calls it, the side effects in the procurement route are skipped.

---

## 3. Invoice lifecycle

**Status enum:** `DRAFT, ISSUED, SENT, PARTIALLY_PAID, PAID, OVERDUE, VOID, WRITE_OFF`

**Primary mutators:**
- `src/app/api/ops/invoices/route.ts` POST (line 195): creates DRAFT invoice.
- `src/app/api/ops/invoices/[id]/route.ts` PATCH (line 69): flips status.
- `src/app/api/ops/invoices/[id]/payments/route.ts` POST (line 11): records Payment, recalculates Invoice amount/status atomically.
- `src/app/api/ops/invoices/from-order/route.ts` POST: generates from an Order, computes `dueDate` from paymentTerm.

### 3.1 DRAFT → ISSUED
| Aspect | Spec | Actual |
|---|---|---|
| Set `issuedAt` | Yes | Yes — line 82: `setClauses.push('"issuedAt" = NOW()')` when status=ISSUED. |
| Compute `dueDate` from paymentTerm | Yes | **No.** The generic PATCH at `[id]/route.ts` does not compute dueDate. Only `from-order` POST (lines 69–80) does it. If you flip DRAFT→ISSUED via the generic PATCH, dueDate stays NULL and nothing can ever mark it OVERDUE. |
| Notify accounting | Yes | **No.** Only the builder-facing email at ISSUED/SENT is sent via `notifyInvoiceCreated()` (line 125). No internal accounting notification. |

### 3.2 ISSUED → SENT
| Aspect | Spec | Actual |
|---|---|---|
| Trigger email via Resend | Yes | Yes — `notifyInvoiceCreated()` fires on `ISSUED` or `SENT` (line 125). This is via Resend wrapped in `@/lib/notifications`. |

### 3.3 SENT → PARTIALLY_PAID / PAID (via Payment creation)
**This one is correctly atomic** at `src/app/api/ops/invoices/[id]/payments/route.ts` (lines 56–71):

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`INSERT INTO "Payment" ...`)
  await tx.$executeRawUnsafe(`UPDATE "Invoice" SET "amountPaid" = $1, "balanceDue" = $2,
    "status" = '${newStatus}'::"InvoiceStatus", "updatedAt" = NOW() ${paidAtClause}
    WHERE "id" = $3`, ...)
})
```

This is the silent-failure that was flagged in the mission — **it is now fixed**. Both rows update inside the same `prisma.$transaction()`.

**But:** when an Invoice is marked PAID, the **linked Job does not move to CLOSED**. The spec says `INVOICED → CLOSED on full payment`. The payments route only updates the Invoice and creates the Payment.

### 3.4 ISSUED → OVERDUE (cron)
| Aspect | Spec | Actual |
|---|---|---|
| Nightly cron flips dueDate < NOW() to OVERDUE | Yes | **No dedicated cron exists.** The only place that writes `status = 'OVERDUE'` is `src/app/api/cron/collections-email/route.ts:123`, and that only happens as a side-effect of successfully sending a collections email. If email fails or the builder has no email, the invoice stays SENT forever. `collections-cycle` cron (line 49) reads "OVERDUE or SENT with dueDate < NOW()" as its working set — it relies on the calculated set, not on the stored `status`. |

**Severity: HIGH.** The `OVERDUE` enum value is essentially cosmetic. AR aging dashboards compute aging from `dueDate` directly (see `src/app/api/ops/invoices/route.ts:156-177`), so status is decorative — but any downstream consumer that filters `status = OVERDUE` will miss invoices that are genuinely overdue but have never had a collections email sent.

---

## 4. Job / Manufacturing lifecycle

**Status enum:** `CREATED, READINESS_CHECK, MATERIALS_LOCKED, IN_PRODUCTION, STAGED, LOADED, IN_TRANSIT, DELIVERED, INSTALLING, PUNCH_LIST, COMPLETE, INVOICED, CLOSED`

**Primary mutators:**
- `src/app/api/ops/jobs/[id]/route.ts` PATCH (line 128): the canonical entrypoint, with real MRP integration and delivery auto-create.
- `src/app/api/ops/portal/installer/jobs/[jobId]/start/route.ts` — moves to INSTALLING.
- `src/app/api/ops/portal/installer/jobs/[jobId]/complete/route.ts` — moves to COMPLETE or PUNCH_LIST.
- `src/app/api/ops/delivery/[deliveryId]/complete/route.ts` — moves to DELIVERED.
- `src/app/api/ops/manufacturing/generate-picks/route.ts` — auto-advances CREATED/READINESS_CHECK to MATERIALS_LOCKED on full allocation (line 208).

### 4.1 Gap table for Job transitions

| Transition | Trigger | Downstream records | Missing |
|---|---|---|---|
| CREATED → READINESS_CHECK | Manual via PATCH | Sets `readinessCheck = true` | No explicit checklist enforcement — the `src/lib/readiness.ts` library may exist but I did not confirm it's called from the PATCH. |
| READINESS_CHECK → MATERIALS_LOCKED | Manual PATCH **or** auto via generate-picks (line 208) when all allocated | Calls `allocateJobMaterials()` (mrp.ts:457), sets `materialsLocked = true` | `pickListGenerated` is only set by the generate-picks POST. No automatic pick generation from the transition itself. |
| MATERIALS_LOCKED → IN_PRODUCTION | Manual PATCH | None | No auto-trigger. No production queue sequencing. |
| IN_PRODUCTION → STAGED | Manual PATCH | Auto-creates Delivery row (if none exists) at job PATCH line 204 | **QC PASS is not required** — QC gate is soft. Also `MaterialPick.status` is not verified on transition. |
| STAGED → LOADED | Manual PATCH | `loadConfirmed = true`, Delivery auto-create (repeat) | No driver/crew auto-assignment. |
| LOADED → IN_TRANSIT | Manual PATCH (driver-initiated per spec, but route is same) | Delivery row created with status=EN_ROUTE if new | Missing driver-portal start endpoint linkage. There is `src/app/api/crew/delivery/[id]/route.ts` for crew actions but it does not appear to transition the Job. |
| IN_TRANSIT → DELIVERED | `POST /api/ops/delivery/[deliveryId]/complete` (line 111) | Updates Delivery to COMPLETE, Job to DELIVERED, creates DeliveryTracking, audit | **Does not create Invoice.** |
| DELIVERED → INSTALLING | `POST /api/ops/portal/installer/jobs/[jobId]/start` | Job status only | N/A |
| INSTALLING → PUNCH_LIST | `POST /api/ops/portal/installer/jobs/[jobId]/complete` when open punch items | Creates/updates Installation row, creates Task rows for punch items | N/A |
| PUNCH_LIST → COMPLETE | Same route when `openPunchCount === 0` | Sets `completedAt = NOW()`, logs DecisionNote | **Does not create Invoice.** **Does not trigger warranty clock.** |
| COMPLETE → INVOICED | Spec says auto | **No code does this.** Manual `POST /api/ops/invoices/from-order` must be called. |
| INVOICED → CLOSED | Spec says on full payment | **No code does this.** Payments route (payments/route.ts) updates Invoice only, never touches Job. |

### 4.2 Special auto-trigger observed

Job PATCH (lines 234–288) contains a **dunnage auto-trigger** that creates Task rows (`Dunnage Door Pickup` + `Final Front Door — Deliver & Install`) when the Job enters `FINAL_FRONT / FINISHING / TRIM_COMPLETE`. This is oddly specific — those status values are **not in** the `JOB_TRANSITIONS` map in `state-machines.ts`. Either the state machine is out of date, or this auto-trigger is dead code that never fires.

**Severity: MEDIUM.** Looks like schema drift between actual Prisma enum and the state-machine library.

---

## 5. Delivery lifecycle

**Status enum:** `SCHEDULED, LOADING, IN_TRANSIT, ARRIVED, UNLOADING, COMPLETE, PARTIAL_DELIVERY, REFUSED, RESCHEDULED` (from state-machines.ts:65). Code also uses `EN_ROUTE` (job PATCH line 221) — another schema drift.

### Gap table

| Transition | Trigger | Downstream | Missing |
|---|---|---|---|
| (none) → SCHEDULED | Should fire on Order READY_TO_SHIP | **No code** — the only auto-create is on Job→LOADED/IN_TRANSIT/STAGED at `src/app/api/ops/jobs/[id]/route.ts:204`. So by the time a Delivery row exists, the Job is already loaded — the SCHEDULED state is effectively unused. |
| Driver assigned | Manual via `POST /api/ops/delivery/dispatch` (line 158) with `ASSIGN_CREW` | `Delivery.crewId` + `routeOrder` update | No automatic assignment on Delivery creation. The `AUTO` action (line 193) chooses the crew with most remaining capacity but requires an explicit POST. |
| SCHEDULED → LOADING → IN_TRANSIT → ARRIVED → UNLOADING → COMPLETE | Per state machine | Code skips intermediate steps — jumps from SCHEDULED/EN_ROUTE straight to COMPLETE at `delivery/[deliveryId]/complete/route.ts:101`. No LOADING, ARRIVED, or UNLOADING transitions are observed in any trigger. |
| COMPLETE | POST complete route | Photos + signature (stored as embedded JSON in `Delivery.notes` — see comment at line 66: "Stores signature + photos as JSON blob in Delivery.notes until blob storage is wired"), Job→DELIVERED, DeliveryTracking row, audit | **Does not create Invoice.** No S3/R2 blob storage for proof-of-delivery — it's base64 embedded in a text column. |

---

## 6. Cross-entity cascades

### 6.1 Cascade gap table

| Cascade | Where it should fire | File:line | Actual behavior | Severity | Fix outline |
|---|---|---|---|---|---|
| Order → Job auto-create | POST `/api/ops/orders` on CONFIRMED (or at creation) | `src/app/api/ops/orders/route.ts:228-524` | **Missing.** Job row is never created by this staff-facing endpoint. | HIGH | After Order insert (line 397), insert a Job row with `scopeType='FULL_PACKAGE'`, `status='CREATED'`, `orderId=...`. Mirror the builder-facing logic at `src/app/api/orders/route.ts:144-179`. |
| Order creation → inventory allocation | POST `/api/ops/orders` | same | **Missing.** No `committed` bump. | MED | Either rely on downstream `allocateJobMaterials()` at MATERIALS_LOCKED (already exists), or introduce soft-reservation at Order creation. Recommend the former — no change needed if Job auto-create is added. |
| Order → Delivery on READY_TO_SHIP | PATCH `/api/ops/orders/[id]` when status→READY_TO_SHIP | `src/app/api/ops/orders/[id]/route.ts:132` | **Missing.** Only auto-create is via Job PATCH. | HIGH | Add a block: `if (status === 'READY_TO_SHIP') { insert Delivery with status='SCHEDULED' if none exists for Order's Job }`. |
| Order SHIPPED → Invoice | PATCH `/api/ops/orders/[id]` | same | **Missing.** | HIGH | Add `if (status === 'SHIPPED' || status === 'DELIVERED') { call the from-order creator via the internal function or inline the logic from `src/app/api/ops/invoices/from-order/route.ts:89-121` }`. |
| Delivery COMPLETE → Invoice | POST `/api/ops/delivery/[deliveryId]/complete` | `src/app/api/ops/delivery/[deliveryId]/complete/route.ts:108-120` | **Missing.** Job advances to DELIVERED but no Invoice is generated. | HIGH | After the `prisma.job.update()` block, call the from-order invoice logic. |
| Invoice PAID → Job CLOSED | POST `/api/ops/invoices/[id]/payments` when newStatus='PAID' | `src/app/api/ops/invoices/[id]/payments/route.ts:56-71` | **Missing.** | HIGH | In the transaction, if `newStatus === 'PAID'`, fetch `invoice.jobId` and update that Job to `CLOSED` (set `status` and `completedAt` if null). |
| Invoice ISSUED (generic PATCH) → dueDate computed | PATCH `/api/ops/invoices/[id]` when status→ISSUED | `src/app/api/ops/invoices/[id]/route.ts:82` | **Missing — only `issuedAt` is set.** | HIGH | Add dueDate computation from paymentTerm (copy block from `src/app/api/ops/invoices/from-order/route.ts:70-80`). |
| Invoice → OVERDUE cron | `src/app/api/cron/*` | **No file exists.** | **Missing.** | HIGH | New cron `src/app/api/cron/invoice-overdue/route.ts`: `UPDATE "Invoice" SET status = 'OVERDUE' WHERE status IN ('ISSUED', 'SENT') AND "dueDate" < NOW()`. Add to `vercel.json`. |
| PO send → email + CommunicationLog | `/api/ops/procurement/purchase-orders/[id]` action=`send` | `src/app/api/ops/procurement/purchase-orders/[id]/route.ts:69-77` | **Missing email, missing log.** | HIGH | Fetch vendor email, build a PO PDF URL (or inline HTML), call `sendEmail()` from `@/lib/email`, insert `CommunicationLog` row with type='PO_SENT'. Also call `defaultExpectedDateForPO(id)` from `src/lib/mrp.ts:417`. |
| PO receive via `/manufacturing-command/receiving` → onOrder decrement | `/api/ops/manufacturing-command/receiving` action=`mark_received` | `src/app/api/ops/manufacturing-command/receiving/route.ts:212` | **Missing.** Bumps onHand only. | HIGH | Replicate the full inventory recompute block from `/api/ops/procurement/purchase-orders/[id]/route.ts:108-128`, or better — have this route call the procurement route internally. |
| Builder credit hold → Order blocked | POST `/api/ops/orders` | `src/app/api/ops/orders/route.ts:319-339` | **Present but buggy.** Line 321 reads `builder.status || builder.accountStatus` but neither field is selected in the SQL on line 312 — only `paymentTerm` is selected. So `builderStatus` is always undefined and the SUSPENDED/ON_HOLD check never triggers. The credit-limit check does work if `creditLimit` is in the builder row (verify). | HIGH | Fix SQL on line 312 to `SELECT "paymentTerm", "status", "creditLimit"`. |
| Hyphen push → Aegis Order + Job | POST `/api/hyphen/orders` | `src/lib/hyphen/processor.ts:527` (Order), `:618` (Job) | **Yes** — Hyphen flow creates both Order and Job. Ironically more complete than the native ops POST. | OK | — |
| InFlow stock change → inventory propagation | `/api/cron/inflow-sync` | `src/lib/integrations/inflow.ts` line 309–333, 433, 452 | **Yes — upsert onHand/onOrder/committed/available.** Committed is pulled from InFlow, not recomputed from Abel Jobs. | MED risk | Potential for InFlow.committed to stomp Abel's job-level commits. Consider either (a) making committed computed locally or (b) not syncing committed from InFlow. |
| Job COMPLETE → warranty clock | `POST /api/ops/portal/installer/jobs/[jobId]/complete` when nextStatus='COMPLETE' | `src/app/api/ops/portal/installer/jobs/[jobId]/complete/route.ts:105-122` | **Missing.** | MED | Set `Job.warrantyStartsAt = NOW()` and `Job.warrantyExpiresAt = NOW() + INTERVAL '1 year'` (or per builder's warranty policy). |
| Job COMPLETE → feedback request | same | same | **Missing.** | LOW | Queue a Notification to the builder after N days. |
| Delivery COMPLETE → proof-of-delivery blob storage | `/api/ops/delivery/[deliveryId]/complete` | line 67 | Stored as base64 JSON in `Delivery.notes` text column — works, but notes column will blow up in size. | MED | Move to S3/R2 blob storage. Sentinel `[PROOF-JSON]:` already makes migration easy. |
| QC PASS → Job auto-advance to STAGED | `POST /api/ops/manufacturing/qc` | `src/app/api/ops/manufacturing/qc/route.ts:127-226` | **Missing.** QC records a QualityCheck but never advances Job.status. | MED | On PASS result, update Job from IN_PRODUCTION to STAGED. |
| QC FAIL → rework Task | same | same | **Missing.** | MED | On FAIL, create a Task with category=REWORK linked to the Job. |
| Pick complete → pickedQty update | `PATCH /api/ops/manufacturing/picks/[id]` and `/warehouse/pick-verify` | verify | Assumed — need to confirm these paths update pickedQty and recompute onHand. | MED | — |
| Automation events (`JOB_STATUS_CHANGED`, `PO_APPROVED`, `PO_RECEIVED`) firing | `fireAutomationEvent()` calls in job POST (line 464), PO approve (line 63), PO receive (line 155) | verified | Present, but `automation-executor.ts` doesn't have specific cases for these triggers — it matches against `automationRule.trigger` strings stored in DB. If no rules configured, events are silent no-ops. | LOW | Confirm automation rules for each trigger are seeded. |
| Audit on every status change | all PATCHes | various | Most routes call `audit()`. Exceptions: the payments POST audit fires AFTER the transaction, which is fine for logging but means a rollback leaves a false audit trail (minor). | LOW | — |
| RBAC on transition | all PATCHes | most routes | Only `checkStaffAuth` — no role-based gates on who can move an Order from CONFIRMED to SHIPPED, etc. | MED | Add a `canTransition(entity, fromStatus, toStatus, role)` check based on `src/lib/permissions.ts`. |
| State-machine validation | all PATCHes | `src/lib/state-machines.ts` exists but is not imported anywhere except maybe UI | `isValidTransition()` is never called before writing the UPDATE. | HIGH | Add a guard at the top of every status-mutating PATCH. |

---

## Top 10 missing cascades — ranked by business impact

1. **Order PATCH does not create Job, Invoice, or Delivery.** The core order-fulfillment workflow is glass held together with manual API calls. A staff user who hits "CONFIRMED" in the ops UI gets a flipped enum and a builder email — nothing else. Ops has to manually POST `/api/ops/invoices/from-order`, manually create Jobs, manually dispatch. This is the single biggest gap.
   *Fix:* In `src/app/api/ops/orders/[id]/route.ts` PATCH (line 132–135), after the status update, branch on new status and fire the appropriate cascade. See gap table rows 1, 3, 4.

2. **Delivery COMPLETE does not create Invoice.** "Invoice on delivery" is Abel's standard practice. Every delivery that lands requires a human to generate the invoice via a separate endpoint.
   *Fix:* `src/app/api/ops/delivery/[deliveryId]/complete/route.ts:108-120` — after the `prisma.job.update({ status: 'DELIVERED' })`, call the invoice-from-order logic.

3. **No cron flips invoices to OVERDUE.** The status stays SENT indefinitely. Dashboards that filter `status = OVERDUE` will under-count. Only invoices that successfully receive a collections email get flipped.
   *Fix:* New cron `src/app/api/cron/invoice-overdue/route.ts` running nightly. Add to `vercel.json`.

4. **Generic Invoice PATCH does not compute dueDate.** If ops flips DRAFT→ISSUED via `PATCH /api/ops/invoices/[id]`, `dueDate` stays NULL and aging breaks.
   *Fix:* `src/app/api/ops/invoices/[id]/route.ts:82` — on status=ISSUED, compute dueDate from `paymentTerm` (copy block from `from-order/route.ts:70-80`).

5. **Two receiving routes with different cascades.** `/manufacturing-command/receiving` bumps onHand without decrementing onOrder or recalculating status. Over time, `onOrder` grows forever and the procurement dashboard lies.
   *Fix:* `src/app/api/ops/manufacturing-command/receiving/route.ts:212-234` — replace the single UPDATE with the full inventory recompute block from `src/app/api/ops/procurement/purchase-orders/[id]/route.ts:108-128`.

6. **Builder credit-hold check is silently broken.** `POST /api/ops/orders:312` selects only `paymentTerm` from the Builder row, then line 321 checks `builder.status` which is always undefined. So the `SUSPENDED / ON_HOLD` guard never fires — only the credit-limit branch can block.
   *Fix:* Change the SELECT on line 312 to include `"status"` and `"creditLimit"`.

7. **Invoice PAID does not close the Job.** Jobs that have been fully paid sit in `INVOICED` (or more often, `COMPLETE`) forever. The state-machine `INVOICED → CLOSED` transition has no caller.
   *Fix:* In `src/app/api/ops/invoices/[id]/payments/route.ts` inside the transaction (line 56), if `newStatus === 'PAID'` and the invoice has a `jobId`, update the Job to CLOSED.

8. **PO send does not email the vendor.** Action `send` flips status to SENT_TO_VENDOR without calling Resend or creating a CommunicationLog. Vendors are supposedly emailed out-of-band, which means there's no audit trail.
   *Fix:* `src/app/api/ops/procurement/purchase-orders/[id]/route.ts:69-77` — fetch vendor email, call `sendEmail()` with the PO details, insert a `CommunicationLog` row. Also call `defaultExpectedDateForPO(id)` from mrp.ts to backfill expectedDate.

9. **State-machine validation is dead code.** `src/lib/state-machines.ts` defines every valid transition but `isValidTransition()` is never imported by any mutation route. Any status string can be written to any entity at any time.
   *Fix:* At the top of each PATCH (jobs, orders, invoices, POs, deliveries), read the current status and call `isValidTransition()` before the UPDATE. Reject 409 if invalid.

10. **QC PASS does not advance the Job; QC FAIL does not create a rework Task.** `POST /api/ops/manufacturing/qc` writes a QualityCheck row and returns. The QC gate the mission statement references is "soft" — nothing in code actually blocks a Job from moving past IN_PRODUCTION without a PASS.
    *Fix:* `src/app/api/ops/manufacturing/qc/route.ts` after line 225 — on result=PASS, advance the Job; on FAIL, insert a Task with category=REWORK.

---

## Specific recommended code edits (file:line → change)

1. **`src/app/api/ops/orders/route.ts:339`** — add `SELECT "paymentTerm", "status", "creditLimit"` to the builder query so the credit-hold check at line 320 actually has data.

2. **`src/app/api/ops/orders/route.ts:397`** (after Order insert) — insert a Job row with `status='CREATED'`, `orderId=orderId`, mirror lines 144–179 in `src/app/api/orders/route.ts`.

3. **`src/app/api/ops/orders/[id]/route.ts:132`** — add cascade blocks:
   - `if (status === 'READY_TO_SHIP')` → insert a `Delivery` row with `status='SCHEDULED'` for the linked Job if none exists.
   - `if (status === 'SHIPPED' || status === 'DELIVERED')` → call the invoice-from-order logic, guarded by "invoice does not already exist for order".

4. **`src/app/api/ops/delivery/[deliveryId]/complete/route.ts:120`** — after the Job update, call the invoice-from-order logic.

5. **`src/app/api/ops/invoices/[id]/route.ts:82`** — on status=ISSUED, compute `dueDate` using the block from `src/app/api/ops/invoices/from-order/route.ts:70-80`.

6. **`src/app/api/ops/invoices/[id]/payments/route.ts:56`** — inside the transaction, if `newStatus === 'PAID'` and `invoice.jobId`, `UPDATE "Job" SET "status" = 'CLOSED'::"JobStatus", "completedAt" = COALESCE("completedAt", NOW()), "updatedAt" = NOW() WHERE "id" = $1`.

7. **Create `src/app/api/cron/invoice-overdue/route.ts`** — runs nightly, `UPDATE "Invoice" SET "status" = 'OVERDUE' WHERE "status" IN ('ISSUED', 'SENT') AND "dueDate" < NOW()`. Add entry to `vercel.json`.

8. **`src/app/api/ops/procurement/purchase-orders/[id]/route.ts:69-77`** (action=`send`) — add:
   - `await defaultExpectedDateForPO(id)` from `@/lib/mrp`.
   - Fetch vendor email, build PO summary HTML, call `sendEmail()`.
   - Insert a `CommunicationLog` row with `type='PO_SENT'`.

9. **`src/app/api/ops/manufacturing-command/receiving/route.ts:212-234`** — replace the `onHand += qty` UPDATE with the full recompute block from `src/app/api/ops/procurement/purchase-orders/[id]/route.ts:108-128`.

10. **`src/app/api/ops/manufacturing/qc/route.ts:225`** — after the QC insert, if `result === 'PASS'` and `jobId`, advance the Job from IN_PRODUCTION to STAGED. If `result === 'FAIL'`, insert a rework Task.

11. **State-machine guard** — at the top of every status-mutating PATCH, load the current status and call `isValidTransition(entityType, current, new)` from `@/lib/state-machines`. Reject 409 if invalid.

12. **`src/app/api/ops/portal/installer/jobs/[jobId]/complete/route.ts:105`** — on `nextStatus === 'COMPLETE'`, also set `warrantyStartsAt = NOW()` and `warrantyExpiresAt = NOW() + INTERVAL '1 year'` (adjust per builder).

---

## Findings not in scope but worth flagging

- **Job status values `FINAL_FRONT, FINISHING, TRIM_COMPLETE`** appear in job PATCH auto-trigger (line 234) but are not in `JOB_TRANSITIONS`. Either state machine is out of date or the auto-trigger is dead.
- **Delivery status `EN_ROUTE`** appears in job PATCH (line 221) but is not in `DELIVERY_TRANSITIONS` (which uses `IN_TRANSIT`). Schema drift.
- **`Order.status = CANCELLED`** has no side effects — no inventory release, no PO cancel, no Job cancel. A cancelled Order leaves its downstream artifacts orphaned.
- **Proof-of-delivery is stored as base64-embedded JSON in a text column** (`Delivery.notes`). Explicit comment at `src/app/api/ops/delivery/[deliveryId]/complete/route.ts:66` acknowledges this is temporary. Will inflate DB size fast.
- **`CommunicationLog`** — the cron `collections-email` at line 113 has a comment "Note: CommunicationLog table does not exist in schema." The model exists in some places in code and not others, so there's a split-brain situation about whether it's real.
- **Audit writes are non-transactional** — most status PATCHes do the UPDATE first, then `audit()`. If the audit fails silently, the change is still persisted. Minor but worth noting for compliance.

---

## Summary counts

- Total transitions audited: **51** across 6 entity types.
- Missing cascades / side effects: **24**.
- Broken cascades (present but buggy): **3** (credit hold SQL, receiving onOrder, QC gate).
- Dead code / schema drift: **3** (state-machine not imported, JOB_TRANSITIONS missing values, Delivery EN_ROUTE).
- Correctly wired end-to-end: **8** (PO receive via procurement, Delivery complete → Job DELIVERED, installer complete → Job COMPLETE, Hyphen → Order + Job, InFlow → InventoryItem, Invoice Payment atomicity, PO creation → onOrder, MRP allocation/release).
