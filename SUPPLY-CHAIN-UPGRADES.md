# Supply Chain & Inventory — Bulletproofing Spec
**Date:** April 29, 2026  
**Author:** Claude (Cowork audit)  
**Requested by:** Nate Barrett  
**Goal:** Never short on a job. Never overstocked. System handles it, not people.

---

## What Exists Today (It's A Lot)

The supply chain infrastructure in Aegis is genuinely impressive — 37 Prisma models, 100+ API routes, 50+ pages, and 8 automated cron jobs. Here's what's built:

**Core Inventory:** `InventoryItem` with onHand/committed/onOrder/available, reorderPoint, reorderQty, safetyStock, maxStock, avgDailyUsage, daysOfSupply, warehouseZone, binLocation. `InventoryAllocation` with RESERVED/PICKED/BACKORDERED/RELEASED/CONSUMED status machine.

**MRP Engine:** `lib/mrp/atp.ts` computes per-job Available-to-Promise with BOM explosion. GREEN/AMBER/RED status per material line. Auto-generates `SmartPORecommendation` rows for RED lines. `lib/mrp/forecast.ts` runs exponential smoothing on 12 months of demand to forecast next 3 months. 90-day time-phased projection via `runMrpProjection()`.

**Automated Crons:**
- `shortage-forecast` (every 4 hours) — scans all active jobs, computes ATP, auto-creates SmartPO recommendations for RED lines, creates InboxItems for alerts, upserts MaterialWatch
- `allocation-health` (nightly 3am) — releases stranded allocations from completed jobs, recomputes committed quantities
- `mrp-nightly` — nightly MRP projection run
- `material-watch` (every 30 min) — checks for inventory arrivals
- `material-confirm-checkpoint` — material confirmation checks
- `gold-stock-monitor` (daily) — kit component availability
- `cycle-count-schedule` (weekly Monday 6am) — generates cycle count batches
- `vendor-scorecard-daily` — vendor performance updates

**Procurement Intelligence:** `SmartPORecommendation` with AI confidence scoring, vendor auto-selection, consolidation groups. Auto-reorder system at `/api/ops/inventory/auto-reorder`. `ProcurementAlert` for supply chain alerts. `MaterialLeadTime` tracking avg/min/max/stdDev per vendor-product.

**Warehouse Ops:** Cycle counting with risk-based SKU selection, bay management with NFC tag support, pick verification/scanning, cross-docking, receiving schedule, daily warehouse plan.

**Vendor Intelligence:** `VendorScorecard` (delivery/quality/cost/communication scores), `VendorPerformanceLog` per-PO, `VendorReturn` with RMA tracking, `CostTrendAnalysis`, `SupplierPriceUpdate` tracking.

---

## The Core Question: Where Does It Break?

The system has the right *architecture* for "never short, never overstocked." But there are critical gaps in the **connections between subsystems** that create blind spots. Here's the flow as it should work, and where it breaks:

```
Order comes in
  → BOM explodes into component requirements
    → ATP checks available inventory vs. requirements
      → GREEN: material reserved (InventoryAllocation created)
      → AMBER: PO is inbound, should arrive before job date
      → RED: shortage — SmartPO recommendation created
        → Someone approves the PO
          → Vendor ships
            → Receiving marks items received
              → onHand increases, allocation satisfied
                → Pick list generated
                  → Material staged
                    → Job built, delivered
```

**Where it breaks:**

---

## CATEGORY 1 — Allocation Lifecycle Gaps

### GAP-1: No Auto-Allocation on Job Creation
**Problem:** When a job is created and linked to an order, the system does NOT automatically allocate inventory for that job's BOM components. Allocations only exist if someone manually creates them or if a downstream process (shortage-forecast cron) happens to flag the job.

**Impact:** A job can sit at "NEW" status with zero allocations. Meanwhile, the same inventory gets committed to later jobs or sold to other builders. When the PM goes to build the job 2 weeks later, the material has been consumed elsewhere.

**Fix:**
- Trigger: when a Job's `orderId` is set (job linked to order)
- Action: BOM-explode the order, for each leaf component: check available inventory → if available >= required, create `InventoryAllocation` with status=RESERVED → decrement `InventoryItem.available`, increment `InventoryItem.committed`
- If any component is unavailable: create allocation with status=BACKORDERED, create SmartPORecommendation immediately (don't wait for the 4-hour cron)
- API: `POST /api/ops/jobs/[id]/auto-allocate`
- Cron: also run as part of the nightly `mrp-nightly` for any jobs that slipped through

**Effort:** ~6 hours. The BOM explosion logic exists in `atp.ts`, the allocation model exists, the auto-reorder exists. This is wiring.

---

### GAP-2: Allocation Status Never Advances Beyond RESERVED
**Problem:** The `InventoryAllocation` status enum supports RESERVED → PICKED → CONSUMED → RELEASED, but there's no process that advances allocations through these stages automatically. Picking creates `MaterialPick` records, but those aren't linked back to `InventoryAllocation` status.

**Impact:** The allocation ledger shows everything as RESERVED forever. You can't tell what's been picked, what's on the truck, or what's been used. The `allocation-health` cron releases stranded allocations for completed jobs, but that's cleanup — not flow.

**Fix:**
- When a `MaterialPick` is created for a job + product: update the matching `InventoryAllocation` to status=PICKED
- When a pick is verified (`MaterialPick.status = VERIFIED`): update allocation to PICKED if not already
- When a job advances to DELIVERED or COMPLETE: update allocations to CONSUMED
- When a job is cancelled: update allocations to RELEASED, restore inventory
- Wire these transitions into the existing status-guard state machine

**Effort:** ~4 hours. The models exist; this is event-driven status updates.

---

### GAP-3: No Allocation → Pick → Stage Flow
**Problem:** There's no automated pipeline from "material is reserved" to "pick list generated" to "material staged in bay." Each of these is a manual step in a different part of the system.

**Impact:** Warehouse team has to manually check which jobs need picks, manually generate pick lists, manually update staging status. Human gaps mean material sits allocated but never gets pulled, or gets pulled for the wrong job.

**Fix:**
- When a job reaches T-72 (or any configurable trigger stage): auto-generate `MaterialPick` records from `InventoryAllocation` rows
- When all picks are verified: auto-advance job to "STAGED" status
- When staged material is loaded on truck: auto-advance to "LOADING"
- The `/api/ops/manufacturing/generate-picks` endpoint exists — wire it to job stage advancement

---

## CATEGORY 2 — Reorder Point & Safety Stock Calibration

### GAP-4: Static Reorder Points (Not Demand-Driven)
**Problem:** `InventoryItem.reorderPoint` defaults to 0 and `safetyStock` defaults to 5 for all products. These are almost certainly not set to real values based on actual demand patterns. A high-velocity item (standard interior door slab) and a slow-moving specialty item (fire-rated commercial frame) have the same default safety stock.

**Impact:** High-velocity items hit stockout because reorderPoint=0 means no alert until it's already gone. Low-velocity items get the same safety stock as high-velocity ones, wasting capital.

**Fix — Demand-Based Reorder Calculation:**
```
reorderPoint = (avgDailyUsage × avgLeadTimeDays) + safetyStock
safetyStock = Z × σ_demand × √(leadTimeDays)
  where Z = 1.65 for 95% service level
  σ_demand = stddev of daily usage (from DemandForecast residuals)
reorderQty = EOQ or round-up to vendor MOQ
maxStock = reorderPoint + reorderQty + (buffer for bulk discount threshold)
```

**Implementation:**
- Create a cron `reorder-calibration` (weekly, Sunday night)
- For each active product with 3+ months of demand history:
  - Pull avgDailyUsage from the DemandForecast actuals
  - Pull avgLeadTimeDays from `MaterialLeadTime` for preferred vendor
  - Calculate reorderPoint, safetyStock, maxStock
  - Update `InventoryItem` with new values
  - Log changes in an audit trail
- For products with no demand history: flag as "NEEDS_REVIEW" (don't auto-set)
- Admin page: `/ops/inventory/reorder-settings` — show all products with current vs. recommended reorder points, allow manual override

**Effort:** ~8 hours for the cron + calculation logic + admin page.

---

### GAP-5: avgDailyUsage and daysOfSupply Not Being Updated
**Problem:** `InventoryItem` has `avgDailyUsage` and `daysOfSupply` fields, both defaulting to 0. The `forecast.ts` module computes demand forecasts but it's unclear whether it writes back to `avgDailyUsage`. If these are always 0, every downstream calculation (reorder points, safety stock, days of supply) is broken.

**Fix:**
- In the MRP nightly cron or forecast cron: after computing per-product demand forecast, update `InventoryItem.avgDailyUsage = monthlyForecast / 30` and `daysOfSupply = onHand / avgDailyUsage`
- Run this on every forecast refresh (at minimum weekly, ideally nightly)
- Surface `daysOfSupply` prominently on the inventory dashboard — anything < leadTimeDays should be flagged

---

### GAP-6: maxStock Not Enforced — No Overstock Alerts
**Problem:** `InventoryItem.maxStock` defaults to 200. There's no process that checks whether a PO would push inventory above maxStock, and no alerts when items are overstocked.

**Impact:** Abel can end up with 500 units of a specialty item that sells 3/month because nothing stops the over-ordering.

**Fix:**
- Auto-reorder system: before generating a PO suggestion, check `(onHand + onOrder + reorderQty) > maxStock`. If yes, reduce the suggested quantity to `maxStock - onHand - onOrder`.
- Overstock alert: in the inventory intelligence endpoint (`/api/ops/inventory/intelligence`), add an OVERSTOCKED status when `onHand > maxStock`
- Inventory dashboard: show overstocked items as a separate section with "excess units" and "excess value" calculations
- Weekly report: dead stock (0 units consumed in 90+ days) and overstocked items

---

## CATEGORY 3 — BOM Integrity

### GAP-7: BOM Coverage Audit
**Problem:** Not every product in the catalog has BOM entries. If a builder orders a "Pre-hung Interior Door, 2/8, Colonist" and that product has no BOM linking it to its components (slab, frame, hinges, casing), the MRP system can't compute material requirements. The ATP calculation returns UNKNOWN instead of RED.

**Impact:** Jobs for products without BOMs will never trigger shortage alerts. Material gets missed entirely.

**Fix:**
- Create a BOM coverage report: `SELECT p.id, p.sku, p.name, COUNT(b.id) as bom_count FROM "Product" p LEFT JOIN "BomEntry" b ON b."parentId" = p.id WHERE p.active = true AND p."productType" = 'ASSEMBLY' GROUP BY p.id HAVING COUNT(b.id) = 0`
- Any product marked as ASSEMBLY or BUNDLE with 0 BOM entries is a gap
- Surface this on the manufacturing dashboard as "Products Missing BOM" with count and drill-down
- Gate: refuse to create a Job for an order containing products with no BOM (or at minimum, show a warning)

---

### GAP-8: BOM Version Control
**Problem:** The `BomEntry` model has no versioning. If a BOM is updated (e.g., switching from a 5mm casing to a 7mm casing), all existing jobs referencing that BOM are retroactively affected. A job that was quoted and allocated based on the old BOM suddenly shows different material requirements.

**Fix:**
- Add `bomVersion` (Int, default 1) to the `BomEntry` model
- When a BOM is modified: create new BOM entries with incremented version, soft-delete old ones
- Jobs should lock to the BOM version at time of creation (store `bomVersion` on the Job or order)
- Display: "This job uses BOM v2 (current is v3)" on job detail

**Effort:** ~6 hours. Schema change + logic.

---

## CATEGORY 4 — Procurement Flow Gaps

### GAP-9: SmartPO Recommendations → Actual PO (Manual Gap)
**Problem:** The shortage-forecast cron creates `SmartPORecommendation` rows. The auto-reorder system creates reorder suggestions. But converting these to actual `PurchaseOrder` records requires someone to review and approve them on the Procurement Intelligence page or Auto-Reorder page. If no one checks those pages, material doesn't get ordered.

**Impact:** The system correctly identifies that material is needed, generates recommendations, but the human-in-the-loop step has no deadline or escalation. Recommendations can sit for days.

**Fix:**
- Auto-approve threshold: if a SmartPO recommendation has `urgency = 'CRITICAL'` AND `aiConfidence > 0.85` AND the amount is under a configurable threshold (e.g., $2,000), auto-convert to a DRAFT PO
- For non-auto-approved: create an InboxItem with a deadline (`orderByDate` from the recommendation). If not actioned by `orderByDate - 2 days`, escalate: push notification + email to the assigned PM and ops manager
- Daily digest email: "You have X pending PO recommendations. Y are critical and need ordering by [date] or jobs [list] will be short."

---

### GAP-10: PO Expected Date Not Tracked Against Job Schedule
**Problem:** When a PO is created (manually or from a recommendation), the `expectedDate` may not align with the job's `scheduledDate`. There's no validation that says "this PO won't arrive in time for the job that needs it."

**Fix:**
- On PO creation: if the PO is linked to jobs (via `SmartPORecommendation.relatedJobIds`), validate that `expectedDate + receivingBuffer (1 day) <= earliest job scheduledDate`
- If the PO won't arrive in time: warn the user and suggest expedited shipping or an alternative vendor with shorter lead time
- On PO expectedDate change: re-run ATP for all linked jobs and update material status

---

### GAP-11: Receiving → Inventory → Allocation Cascade
**Problem:** When a PO is received at `/ops/receiving`, the `PurchaseOrderItem.receivedQty` is updated and `PurchaseOrder.status` advances. But does `InventoryItem.onHand` actually increase? And do BACKORDERED allocations automatically get satisfied?

**Fix — Verify or Build the Cascade:**
1. On receiving: `InventoryItem.onHand += receivedQty`, `InventoryItem.onOrder -= receivedQty`
2. After onHand increases: scan `InventoryAllocation` for BACKORDERED rows on the same productId → flip to RESERVED → update `InventoryItem.committed += qty`, `InventoryItem.available -= qty`
3. Priority: satisfy BACKORDERED allocations in scheduledDate order (soonest job first)
4. After satisfying backorders: re-run ATP for affected jobs → update MaterialWatch status to ARRIVED
5. Notify the PM: "Material [X] has arrived for Job [Y] — ready to pick"

---

### GAP-12: Vendor Lead Time Learning
**Problem:** `MaterialLeadTime` has avg/min/max/stdDev fields, and `VendorPerformanceLog` tracks actual vs. expected delivery dates per PO. But are these feeding back into the reorder calculations? If Boise Cascade's actual lead time is 14 days but the system thinks it's 7, the reorder trigger fires too late.

**Fix:**
- In the `vendor-scorecard-daily` cron: after computing delivery performance, update `MaterialLeadTime` for each vendor-product combo using the last 12 POs
- Feed updated lead times into the reorder point calculation (GAP-4)
- Alert: if a vendor's average lead time has increased by >25% in the last 30 days, create a `ProcurementAlert`
- Surface on vendor detail page: "Lead time trend: 7 days → 12 days (↑71% over 90 days)"

---

## CATEGORY 5 — Visibility & Alerting

### GAP-13: No "Job Readiness" Dashboard
**Problem:** There's a Material Calendar at `/ops/material-calendar` and ATP via the shortage-forecast cron, but there's no single view that answers: "Which of my next 10 jobs are 100% ready to build, and which ones are missing material?"

**Impact:** PMs check the job pipeline, see a job is "in production," assume material is there, send the crew — and find out at the warehouse that 2 items are backordered.

**Fix — Job Readiness Board:**
- New page: `/ops/job-readiness` (or add as a view to Material Calendar)
- For each active job in the next 14 days:
  - Overall material status: GREEN (all allocated) / AMBER (PO inbound) / RED (shortage, no PO)
  - Per-line breakdown: what's reserved, what's picked, what's backordered, what's missing
  - Action buttons: "Create PO for missing items" / "Escalate to vendor" / "Substitute"
- Sort by scheduledDate ascending
- Filter: by PM, by builder, by status (show me only RED jobs)
- This becomes Brittney's Monday morning view: "Here are my 6 jobs this week, here's what's ready and what isn't"

---

### GAP-14: No Proactive PM Notification for Material Shortages
**Problem:** The shortage-forecast cron creates InboxItems and SmartPO recommendations when it finds RED lines. But InboxItems go to a global inbox — not targeted to the PM who owns the job. The PM has no notification system that says "Hey Brittney, your Toll Brothers job at Lone Star Ranch is missing 4 interior slabs."

**Fix:**
- When a RED line is detected for a job: look up the job's `assignedPmId`
- Send notification to that PM (InboxItem filtered by `assignedPmId`, plus email via Resend)
- Include: job number, builder, community, scheduled date, what's short, recommended action
- Escalation: if the shortage isn't resolved within 48 hours, escalate to ops manager
- Daily email digest to each PM: "Your material readiness report — 4 GREEN, 1 AMBER, 1 RED"

---

### GAP-15: No Overstock / Dead Stock Alerts
**Problem:** The inventory intelligence endpoint has dead stock detection logic, but there's no automated alert or report when items are sitting idle.

**Fix:**
- Weekly cron: scan for items where `onHand > 0` AND last consumption > 90 days ago
- Calculate: excess value = `(onHand - maxStock) × unitCost` for overstocked items
- Calculate: dead value = `onHand × unitCost` for items with zero demand in 90+ days
- Report: email to ops manager with dead stock list and total tied-up capital
- Action suggestions: return to vendor (check return window), clearance pricing, cross-sell to other builders

---

### GAP-16: Material Calendar Shows Empty
**Problem:** The PM audit found that `/ops/material-calendar` shows 0 jobs for the current week despite 367 active jobs and 225 overdue milestones. The calendar API at `/api/ops/material-calendar` returns jobs bucketed by scheduledDate with GREEN/AMBER/RED material status, but either dates aren't set or the query filters too aggressively.

**Fix:**
- Audit query: `SELECT COUNT(*) FROM "Job" WHERE "scheduledDate" IS NOT NULL AND "status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')`
- If count > 0 but calendar shows empty: the frontend date bucketing is wrong (timezone issue? week calculation?)
- If count = 0: jobs don't have scheduledDate populated — need to wire job creation to set a default scheduled date based on lead time
- Material Calendar should also show jobs WITHOUT a scheduled date as "Unscheduled" bucket — don't hide them

---

## CATEGORY 6 — Inventory Accuracy

### GAP-17: Cycle Count → Inventory Adjustment Not Automated
**Problem:** The cycle count system generates count batches (weekly cron), provides a counting interface, and records results. But when a cycle count reveals a variance (counted 47, system shows 52), does the system auto-adjust `InventoryItem.onHand`?

**Fix:**
- On cycle count completion: if variance exceeds a configurable threshold (e.g., 2% or 5 units), create an `InventoryAdjustment` record for audit trail
- Auto-update `InventoryItem.onHand` to the counted value
- Recalculate available, committed, daysOfSupply
- If the adjustment creates a new shortage (previously GREEN allocation now goes RED), trigger the shortage alert pipeline
- Report: weekly cycle count accuracy rate, top variance SKUs, total variance value

---

### GAP-18: No Receiving Verification
**Problem:** When a PO is received, does anyone verify that the received quantity matches what was ordered? The `PurchaseOrderItem` has `receivedQty` and `damagedQty` fields, but is there a forced check?

**Fix:**
- Receiving workflow: scan/enter each line item quantity → system compares to orderedQty
- If `receivedQty < quantity`: flag as partial receipt, keep PO at PARTIALLY_RECEIVED, create alert
- If `receivedQty > quantity`: flag as over-receipt, require supervisor approval
- If `damagedQty > 0`: auto-create a `VendorReturn` (RMA) and log in `VendorPerformanceLog` with qualityScore penalty
- Bar/QR code scanning: if products have SKU barcodes, enable scan-to-receive for speed and accuracy

---

## CATEGORY 7 — Gold Stock & Kitting

### GAP-19: Gold Stock Kit Alerts Not Actionable
**Problem:** The gold-stock-monitor cron checks kit component availability daily. But when a kit component runs low, what happens? Is there an auto-reorder for kit components? Is there an alert to the warehouse team?

**Fix:**
- When a kit component drops below safetyStock: auto-create a SmartPORecommendation for that component, flagging it as "GOLD_STOCK_REPLENISH"
- Alert: notify warehouse supervisor that Gold Stock kit [X] can only build [N] more units
- Dashboard: show Gold Stock health on the warehouse portal — "Standard Interior Kit: 14 complete kits ready, component [slab 2/8] is limiting factor (3 remaining)"

---

## CATEGORY 8 — Demand Forecasting Improvements

### GAP-20: Forecast Not Accounting for Pipeline Jobs
**Problem:** The demand forecast uses 12 months of historical order data (exponential smoothing). But it doesn't factor in COMMITTED future demand from jobs already in the pipeline. If Toll Brothers just sent 15 new orders for Canyon Ridge Phase 2, the forecast doesn't see that spike until the orders are old enough to appear in history.

**Fix:**
- Hybrid forecast: historical trend + confirmed pipeline demand
- Pipeline demand = sum of BOM-expanded material requirements for all active jobs not yet COMPLETE
- Adjusted forecast = max(statistical forecast, pipeline demand for next 30/60/90 days)
- This is especially critical for Abel because builder orders come in waves (new phase, new community)

---

### GAP-21: Seasonality Not Modeled
**Problem:** The exponential smoothing model uses a flat α=0.3 with no seasonal adjustment. DFW construction has clear seasonality — more starts in spring/fall, slower in summer (heat) and winter (holidays). Ignoring this means the system over-orders in slow months and under-orders before ramp-ups.

**Fix:**
- Upgrade from simple exponential smoothing to Holt-Winters (triple exponential smoothing) for products with 18+ months of history
- Seasonal factors by month: calibrate from 2+ years of data
- `MaterialLeadTime.seasonalFactors` (JSONB field) already exists — populate it
- For products with < 18 months: stick with simple smoothing but apply a category-level seasonal index

---

## CATEGORY 9 — Integration & Data Quality

### GAP-22: InventoryItem ↔ Product Sync
**Problem:** `InventoryItem` has a 1:1 relationship with `Product` via `productId`. But are all active products represented in `InventoryItem`? If a new product is added to the catalog without a corresponding `InventoryItem`, it's invisible to the inventory system.

**Fix:**
- On product creation: auto-create an `InventoryItem` with defaults (onHand=0, reorderPoint=0, safetyStock=5)
- Data audit: `SELECT p.id FROM "Product" p LEFT JOIN "InventoryItem" ii ON ii."productId" = p.id WHERE p.active = true AND ii.id IS NULL` — these are products with no inventory tracking
- Nightly cron: ensure every active product has an InventoryItem record

---

### GAP-23: PO Numbers ↔ Vendor Confirmation
**Problem:** POs are sent to vendors but there's no confirmation receipt tracking. Did Boise Cascade acknowledge PO-2026-0452? When they confirmed, did the expected date change?

**Fix:**
- Add `vendorConfirmedAt`, `vendorConfirmedDate` (their promised date, may differ from `expectedDate`), `vendorPONumber` (their reference #) to PurchaseOrder
- Workflow: after sending PO, status goes to SENT_TO_VENDOR → when vendor confirms, update to APPROVED with their confirmed date
- If vendor's confirmed date is later than our expected date: alert the PM for any affected jobs

---

### GAP-24: InFlow Sync Gaps
**Problem:** Products have `inflowId` and `lastSyncedAt` fields. PurchaseOrders have `inflowId`. But how current is the InFlow sync? If InFlow is the source of truth for current on-hand quantities and the sync is stale, Aegis is making decisions on old data.

**Fix:**
- Check: `SELECT MAX("lastSyncedAt") FROM "Product"` — if this is more than 24 hours old, the sync is stale
- If InFlow is still the operational inventory system: the sync must run at minimum hourly for inventory quantities
- Long-term: Aegis should become the source of truth for inventory (with InFlow as legacy/backup). This means receiving, adjustments, and picks must all happen in Aegis.

---

## Implementation Priority Order

### Week 1 — Stop the Bleeding (Material Shortages)
1. GAP-1: Auto-allocate on job creation (~6 hrs)
2. GAP-16: Fix Material Calendar empty issue (~2 hrs)
3. GAP-14: PM notification for material shortages (~3 hrs)
4. GAP-5: Update avgDailyUsage and daysOfSupply nightly (~2 hrs)
5. GAP-9: SmartPO auto-approve for critical items (~3 hrs)

### Week 2 — Reorder Intelligence
6. GAP-4: Demand-driven reorder point calculation (~8 hrs)
7. GAP-6: Overstock alerts and maxStock enforcement (~3 hrs)
8. GAP-12: Vendor lead time learning feedback loop (~3 hrs)
9. GAP-10: PO expected date vs. job schedule validation (~2 hrs)
10. GAP-11: Receiving → inventory → allocation cascade verification (~4 hrs)

### Week 3 — Visibility & Flow
11. GAP-13: Job Readiness Board (~6 hrs)
12. GAP-2: Allocation status advancement (RESERVED → PICKED → CONSUMED) (~4 hrs)
13. GAP-3: Auto-generate picks on stage advancement (~3 hrs)
14. GAP-7: BOM coverage audit + dashboard (~3 hrs)
15. GAP-15: Dead stock / overstock weekly report (~3 hrs)

### Week 4 — Accuracy & Polish
16. GAP-17: Cycle count → auto-adjustment (~3 hrs)
17. GAP-18: Receiving verification workflow (~4 hrs)
18. GAP-22: Product ↔ InventoryItem sync (~2 hrs)
19. GAP-19: Gold stock kit auto-reorder (~2 hrs)
20. GAP-23: PO vendor confirmation tracking (~3 hrs)

### Month 2 — Advanced
21. GAP-20: Pipeline-aware demand forecasting (~6 hrs)
22. GAP-21: Seasonal demand modeling (~8 hrs)
23. GAP-8: BOM version control (~6 hrs)
24. GAP-24: InFlow sync audit + migration path (~variable)

---

## The "Bulletproof" Target State

When all gaps are closed, here's how the system works end-to-end:

```
1. Builder submits order
   → System explodes BOM into leaf components
   → For each component: check available inventory
     → Available? RESERVE it (allocation created, committed updated)
     → Not available? Check inbound POs
       → PO arriving before job date? Mark AMBER, track
       → No PO? Create SmartPO recommendation (RED)
         → Under $2K + high confidence? Auto-create draft PO
         → Over threshold? Alert ops + PM with deadline

2. Every 4 hours: shortage-forecast cron re-scans all jobs
   → Catches anything missed, updates statuses
   → Escalates unresolved REDs

3. Every night: reorder calibration updates safety stock & reorder points
   → Based on actual demand velocity + vendor lead times
   → Adjusts for seasonal patterns

4. PO sent to vendor
   → System tracks vendor confirmation + promised date
   → If promised date doesn't cover job schedule → alert + suggest alternatives

5. Material arrives at warehouse
   → Receiving verifies qty and quality
   → InventoryItem.onHand updated
   → BACKORDERED allocations auto-satisfied (soonest job first)
   → PM notified: "Your material is in"
   → MaterialWatch status → ARRIVED

6. Job approaches scheduled date (T-72)
   → Auto-generate pick list from allocations
   → Warehouse picks, verifies, stages
   → Allocation status: RESERVED → PICKED → STAGED

7. Job ships, delivers, completes
   → Allocation status: CONSUMED
   → Inventory decremented
   → If onHand < reorderPoint → trigger reorder

8. Weekly reports
   → Dead stock (0 demand, 90+ days)
   → Overstocked items (onHand > maxStock)
   → BOM coverage gaps
   → Cycle count accuracy
   → Vendor performance trends
```

**No human should need to remember to check inventory before scheduling a job. The system tells them.**

---

## Key Files Reference

| Component | Path |
|-----------|------|
| ATP Calculation | `src/lib/mrp/atp.ts` |
| Demand Forecast | `src/lib/mrp/forecast.ts` |
| MRP Projection | `src/lib/mrp/index.ts` (runMrpProjection) |
| Change Order Impact | `src/lib/mrp/co-impact.ts` |
| Shortage Forecast Cron | `src/app/api/cron/shortage-forecast/route.ts` |
| Allocation Health Cron | `src/app/api/cron/allocation-health/route.ts` |
| MRP Nightly Cron | `src/app/api/cron/mrp-nightly/route.ts` |
| Material Watch Cron | `src/app/api/cron/material-watch/route.ts` |
| Cycle Count Cron | `src/app/api/cron/cycle-count-schedule/route.ts` |
| Vendor Scorecard Cron | `src/app/api/cron/vendor-scorecard-daily/route.ts` |
| Gold Stock Monitor Cron | `src/app/api/cron/gold-stock-monitor/route.ts` |
| Auto-Reorder API | `src/app/api/ops/inventory/auto-reorder/route.ts` |
| Smart PO Recommendations | `src/app/api/ops/procurement-intelligence/smart-po/route.ts` |
| Material Calendar API | `src/app/api/ops/material-calendar/route.ts` |
| Job Materials API | `src/app/api/ops/jobs/[id]/materials/route.ts` |
| Job Allocations API | `src/app/api/ops/jobs/[id]/allocations/route.ts` |
| BOM Management API | `src/app/api/ops/manufacturing/bom/route.ts` |
| Pick Generation API | `src/app/api/ops/manufacturing/generate-picks/route.ts` |
| Receiving API | `src/app/api/ops/receiving/[id]/receive/route.ts` |
| Inventory Dashboard | `src/app/ops/inventory/page.tsx` |
| Material Calendar Page | `src/app/ops/material-calendar/page.tsx` |
| Manufacturing Dashboard | `src/app/ops/manufacturing/page.tsx` |
| Warehouse Portal | `src/app/ops/portal/warehouse/page.tsx` |
| Procurement Intelligence | `src/app/ops/procurement-intelligence/page.tsx` |
| Prisma Schema | `prisma/schema.prisma` |

---

## Existing vs. Missing Summary

| Capability | Status | Notes |
|-----------|--------|-------|
| BOM explosion for orders | ✅ EXISTS | ATP lib does this |
| ATP (Available-to-Promise) | ✅ EXISTS | GREEN/AMBER/RED per line |
| Shortage detection (4-hour cron) | ✅ EXISTS | Creates SmartPO recommendations |
| Auto-reorder below reorder point | ✅ EXISTS | Generates vendor-grouped suggestions |
| Allocation model | ✅ EXISTS | RESERVED/PICKED/BACKORDERED/RELEASED/CONSUMED |
| Allocation health cleanup | ✅ EXISTS | Nightly cron releases stranded rows |
| Demand forecasting | ✅ EXISTS | Exponential smoothing, 3-month horizon |
| Vendor performance tracking | ✅ EXISTS | Scorecards, lead time logs, returns |
| Cycle counting | ✅ EXISTS | Weekly risk-based scheduling |
| Warehouse bay management | ✅ EXISTS | NFC tag support |
| Pick list generation | ✅ EXISTS | Manual trigger |
| Auto-allocate on job creation | ❌ MISSING | Critical gap |
| Allocation status advancement | ❌ MISSING | Everything stays RESERVED |
| Demand-driven reorder points | ❌ MISSING | Static defaults (0/5) |
| Overstock/dead stock alerts | ❌ MISSING | No enforcement |
| Job Readiness Board | ❌ MISSING | No single PM view |
| PM shortage notifications | ❌ MISSING | Global inbox only |
| SmartPO auto-approve | ❌ MISSING | All manual |
| Receiving → allocation cascade | ⚠️ UNVERIFIED | May not be wired |
| PO date vs. job schedule check | ❌ MISSING | No validation |
| BOM coverage audit | ❌ MISSING | Unknown gap size |
| Material Calendar | ❌ BROKEN | Shows empty |
| Seasonal demand modeling | ❌ MISSING | Flat forecast only |
| Pipeline-aware forecasting | ❌ MISSING | Historical only |
| BOM versioning | ❌ MISSING | Retroactive changes |
| avgDailyUsage updates | ⚠️ UNVERIFIED | May not be running |

---

*Generated from deep supply chain audit on April 29, 2026*
