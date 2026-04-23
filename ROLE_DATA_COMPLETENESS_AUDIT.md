# Role Data Completeness Audit — Abel OS

**Date:** 2026-04-22
**Scope:** All 13 StaffRole values × their primary daily pages
**Method:** Read each page's `fetch()` calls, traced to APIs, then verified the actual data the APIs return against live Neon Postgres data.
**Preceded by:** Access audit. That one asked "can they see it?" This one asks "is what they see actually *useful*?"

---

## Executive summary

**The system works — but it's starving.** Most portal pages compile, auth, and load without error. The gaps are in the *data layer*, not the UI.

The four biggest systemic problems, ranked by pain:

1. **Role-specific portals read from empty tables.** The sales `/portal/sales/next-stop` page queries `Activity` for today's meetings — `Activity` has **0 rows**. The QC queue queries `Inspection` — **0 rows**. Installer portal reads from the same empty `Inspection` table. Warehouse briefing reads `MaterialPick` — **0 rows**. These pages were built before their data sources were wired. They render "No inspections scheduled" / "No stops today" every single day and look broken even though the code works.

2. **Status-string drift.** The Collections API queries `Invoice.status IN ('SENT','PARTIAL')` but the actual enum values in the DB are `ISSUED`, `PARTIALLY_PAID`, `OVERDUE`. The Collections page shows **0 overdue invoices** despite there being **21 actually overdue ($49K)**. Dawn is looking at a dashboard that lies.

3. **PM assignment has a 55% hole.** Of **1,023 jobs**, only **450 have a `assignedPMId`**. The PM portal's "My Jobs" list filters to assigned jobs — so PMs only see ~45% of what they should be managing. The remaining 573 orphan jobs (including **280 active** in CREATED/READINESS_CHECK/IN_PRODUCTION) show up for nobody.

4. **Role-assigned workload is unevenly plumbed.** 100% of INSTALLING, MATERIALS_LOCKED, and STAGED jobs have a PM. Only **3%** of IN_PRODUCTION (10/290) and **29%** of CREATED (71/248) do. The assignment flow breaks early in the pipeline and catches up late — meaning PMs don't see jobs in the stages that most need attention.

Nine other important but smaller gaps follow in the per-role audit below.

---

## Live data baseline

The whole audit sits on this snapshot (queries executed at report time):

| Metric | Value | Notes |
|---|---|---|
| Orders (total / open) | 3,651 / 330 | 302 RECEIVED, 28 CONFIRMED |
| Orders today | 37 | healthy volume |
| Invoices (total / overdue) | 112 / 21 | $49K overdue unaddressed |
| Builders | 177 | Pulte account already lost |
| Purchase Orders (total / open) | 3,759 / 33 | 314 SENT_TO_VENDOR, 24 DRAFT |
| Overdue POs | 135 / $288K | past expectedDate, not received |
| Deliveries (total / active) | 211 / 0 | all marked COMPLETE — no IN_TRANSIT |
| Deliveries today | 7 (all COMPLETE) | nothing scheduled forward |
| Quotes total | 8 (7 DRAFT, 1 ORDERED) | 6 of 7 are test-audit rows |
| Takeoffs | 8 (all APPROVED) | 7 in last 30 days |
| Material Picks | 0 | table exists, never populated |
| Inspections | 0 | same |
| Activities | 0 | same |
| Tasks | 0 | same |
| Deals | 2 (both stalled 14+ days) | pipeline is empty |
| Staff | 65 total | 12 DRIVER, 13 PM, 11 VIEWER, 3 SALES_REP, 1 ESTIMATOR, 1 PURCHASING |
| ScheduleEntry rows today | 40 | this is where deliveries live |
| ReorderSuggestion | 0 | auto-reorder triggers never fired |
| FinancialSnapshot | 0 | snapshots never captured |
| DecisionNote | 5 | PMs have logged a handful |
| MonthlyClose | table doesn't exist | `/portal/accounting/close` has nothing to show |

Last 6 months revenue:

| Month | Orders | Revenue |
|---|---|---|
| 2026-04 | 166 | $623K |
| 2026-03 | 213 | $161K |
| 2026-02 | 246 | $115K |
| 2026-01 | 172 | $94K |
| 2025-12 | 144 | $189K |
| 2025-11 | 160 | $318K |

April's revenue spike explains why **the executive dashboard looks alive** even though half the operational tables are empty — orders and invoices flow, but the workflow-glue tables (Activity, Task, MaterialPick, Inspection) never got seeded.

---

## Role × page audit

### ADMIN (Nate, 5 staff)

Pages: `/ops`, `/ops/executive`, `/ops/command-center`, `/ops/finance`, `/ops/integrations`

`/api/ops/dashboard` and `/api/ops/executive/dashboard` return real order pipeline, top builders, revenue-YTD, MoM growth, AR outstanding — all from actual rows. Command Center queries `/api/agent-hub/status` but the NUC worker cluster is not yet deployed (tracked in `ABEL_NUC_MASTER_TRACKER.md`), so the Agent Fleet panel shows OFFLINE. `ActivityFeed` renders blank because `Activity` has 0 rows. `/ops/integrations` has no per-integration `lastSyncAt` display. AP forecasting on `/ops/finance` infers from open POs — no `VendorBill` model exists, so AP is approximate.

**Score: 8/10.** Nate gets enough to run the business. Blind spots are known-and-accepted, not broken.

---

### MANAGER (Clint, Dawn, Dalton, +5, 8 staff)

Pages: `/ops/executive`, `/ops/command-center`, `/ops/kpis`, `/ops/finance`, `/ops/staff`

`/api/ops/kpis` shows deliveries, revenue, AR aging, quote conversion, active crews, low-stock. Quote conversion is computed from 8 quotes where **7 are `test-audit-*` test rows** — single real conversion distorts the rate. On-time delivery rate = 100% because all 211 deliveries are already COMPLETE (no IN_TRANSIT state ever). Low-stock count shows 0 because the filter is `onHand <= reorderPoint AND onHand > 0` — 41 actual stockouts at 0 don't trigger. `/ops/staff` has no `lastLoginAt` column, so managers can't see who's idle.

**Score: 7/10.** KPIs exist but several are distorted by test data, premature state transitions, and filter-logic edges.

---

### PROJECT_MANAGER (Chad, Brittney, Thomas, Ben, 13 staff)

Pages: `/ops/portal/pm`, `/ops/projects`, `/ops/schedule`, `/ops/jobs`, `/ops/builder-health`

`/ops/portal/pm` fetches jobs (active statuses), ScheduleEntry (7d deliveries, 40 rows today), tasks, decision notes, top builders. Major issues:

- **573 of 1,023 jobs have no PM assigned**, including **280 active** (CREATED / READINESS_CHECK / IN_PRODUCTION). Only **3%** of IN_PRODUCTION jobs (10/290) are assigned. PM portal's "My Jobs" doesn't filter by ownership — first 10 active jobs show regardless of who's logged in.
- **`Task` table has 0 rows.** The portal's "Open Tasks" card is always `All tasks completed!` — false reassurance.
- **DecisionNote has 5 rows** but the portal reads from the first 10 jobs returned, so PMs may not see their own notes.
- **"Top Builders" widget sorts by `createdAt desc`** — shows *newest* builders, not highest-revenue. Brittney sees whoever was added yesterday, not Brookfield.
- `/ops/builder-health` has data (133 BuilderIntelligence rows) but isn't linked from the PM portal header.

**Score: 5/10.** Assignments broken, tasks empty, top-builder widget mis-sorted.

---

### SALES_REP (Dalton, Sean, +1, 3 staff)

Pages: `/ops/portal/sales/next-stop` (NEW), `/ops/sales/pipeline`, `/ops/accounts`, `/ops/quotes`

Best-built portal in the platform — mobile-first, today's stops, last-3-touches, AI prep, AR flags. Runs on empty tables:

- **`Activity` has 0 rows.** `/today-stops` queries `Activity WHERE scheduledAt = today AND activityType IN ('MEETING','SITE_VISIT','CALL')` — always empty. Dalton sees "No calendar stops" every day.
- **`Deal` has 2 rows, both stalled 14+ days.** Pipeline page is visually empty. DealActivity follow-ups can't populate stops.
- **Quotes: 7/8 are `test-audit-*`.** Only real quote is from March.
- **Accounts page has 177 real builders** — works fine, but no "my accounts" filter.
- **AI prep (`/api/ops/ai/builder-snapshot`) works** — generates real text.
- **Log-visit writes `CommunicationLog`** but nobody calls it because nobody sees stops to log. Chicken-and-egg.

**Score: 4/10.** Beautiful UI, starved of data. Fix: wire Google Calendar → Activity, or backfill from ScheduleEntry (40 today).

---

### ESTIMATOR (Lisa Adams, 1 staff)

Pages: `/ops/takeoff-tool` (NEW), `/ops/takeoff-review`, `/ops/quotes`, `/ops/floor-plans`

8 Takeoffs exist, all APPROVED, 7 from the last 30 days — tool is actively used. `/takeoff-review` is always empty because nothing's pending. Takeoff→Quote handoff is unclear: 0 quotes in NEEDS_PRICING status. `/ops/floor-plans` has an upload flow that overlaps with takeoff-tool. No per-estimator scoping, but only one estimator exists today.

**Score: 7/10.** Works, gaps don't hurt with a one-person team.

---

### ACCOUNTING (Dawn Meehan +2, 3 staff)

Pages: `/ops/portal/accounting/close` (NEW), `/ops/finance/ar`, `/ops/collections`, `/ops/invoices`

Worst role × data score in the audit:

- **`MonthlyClose` table does not exist** in the DB. `/api/ops/finance/monthly-close` will error. Dawn cannot close April using the portal.
- **`FinancialSnapshot` has 0 rows.** The "Take snapshot" close step has no underlying cron populating it.
- **Collections page hides the overdues.** `/api/ops/collections` filters on `status IN ('SENT','PARTIAL')` but DB values are `ISSUED`, `PARTIALLY_PAID`, `OVERDUE`. **21 overdue invoices ($49K) invisible.**
- **AR-predict page surfaces the same 21 overdues correctly** — so `/finance/ar` and `/collections` display contradicting numbers from the same source.
- **AP is PO-inferred, not bill-based.** No `VendorBill` model exists. "Owe Boise $87K Tuesday" isn't representable.
- **QB sync is a stub.** The close checkbox exists (`<Badge>stub</Badge>` in code) but doesn't push to QuickBooks.
- **6 DRAFT invoices ($50K)** never surfaced on accounting overview — Dawn has to drill in.

**Score: 3/10.** If Nate wants Dawn closing books in Abel OS, this is 80% of the fixing.

---

### PURCHASING (1 staff)

Pages: `/ops/portal/purchasing/briefing`, `/ops/purchasing`, `/ops/mrp`, `/ops/inventory/auto-reorder`

Briefing shows overdue POs (135 / $288K), pending approvals (8 / $7.6K), arriving today (0), recent receiving. Live data is accurate. Gaps:

- **"Critically Low" card filter** uses `onHand <= reorderPoint AND onHand > 0` — skips 41 items at actual 0. These show on the MRP page but not the briefing. Two pages to see all urgent items.
- **`ReorderSuggestion` has 0 rows** — cron is dead. Auto-reorder page queries InventoryItem live so still works.
- **Vendor on-time rates** use nullable `actualDate`. Most POs have `receivedAt` only — scorecards skewed.
- No cash-impact forecast when approving.

**Score: 6/10.** Workable. Main annoyance is the stockout split across two pages.

---

### WAREHOUSE_LEAD (1 staff)

Pages: `/ops/portal/warehouse/briefing`, `/ops/manufacturing`, `/ops/warehouse/bays`, `/ops/receiving`

Briefing is ambitious — jobs in production, picks, QC queue, staging, materials arriving, exceptions. Gutted by empty data:

- **`MaterialPick` has 0 rows.** All pick-related metrics = 0. Pick-completed vs remaining across 290 IN_PRODUCTION jobs: 0 vs 0.
- **QC Needed filters `Job.status = 'READY_FOR_QC'`** — that status value is unused. Always empty.
- **Staging Ready filters `READY_TO_STAGE`** — also unused (14 STAGED jobs are past this).
- **Materials Arriving filters expectedDate = today** — 0 rows.
- No stockout alerts on the briefing despite 41 stockouts in inventory.

**Score: 3/10.** UI shows 6 zeros and an empty production queue. Looks broken even though the code runs.

---

### WAREHOUSE_TECH (5 staff)

Pages: `/ops/warehouse/pick-scanner`, `/ops/manufacturing/picks`, `/ops/manufacturing/build-sheet`

`fetchJobs()` in the pick scanner is literally `setJobs([])` with a comment: *"For now, we'll show a message that jobs would be loaded."* Dropdown is empty by design — techs can't even select a job. Even if they could, `MaterialPick` has 0 rows.

**Score: 2/10.** Pick scanner is a shell with a TODO in production.

---

### DRIVER (12 staff — largest role group)

Pages: `/ops/portal/driver` (NEW), `/ops/delivery/today`, `/ops/fleet`

Polished mobile-first UX — sticky header, big tappable cards, offline queue, optional GPS. Runs on a broken pipeline:

- **Every Delivery is COMPLETE.** All 211 rows in the DB are `status = COMPLETE`. Zero SCHEDULED, zero IN_TRANSIT. Deliveries jump straight to done at creation.
- **Today's deliveries: 7, all COMPLETE.** Drivers open the portal at 6 AM and see "7/7 stops done" — looks retrospective, never prospective.
- Builder phone pulls from Job.builderContact → Builder.phone, often null.
- routeOrder column exists and is respected by the UI, but only reflects completed routes.

**Score: 3/10.** Best-looking portal on the worst data. Drivers can't see tomorrow because nothing's ever scheduled forward.

---

### QC_INSPECTOR (0 staff — role exists, nobody holds it)

Pages: `/ops/portal/qc/queue`, `/ops/inspections`, `/ops/manufacturing/qc`

`Inspection` has 0 rows. All KPIs 0 or N/A. `READY_FOR_QC` status unused in `Job`. No staff assigned to this role. The Pass/Fail/Pass+Notes modal wires to `/api/ops/inspections` POST which probably works — but nobody calls it.

**Score: 1/10.** Theoretical workflow.

---

### INSTALLER (2 staff)

Pages: `/ops/portal/installer` (NEW), `/ops/inspections`

60 INSTALLING jobs exist, all with assigned PM — this role has real data. 5 DecisionNote rows surface as high-priority notes. Weather strip is hardcoded `"72°F · Clear · DFW"`. "Avg Time / Install" KPI is `—` (noted "No data yet"). Inspections page empty.

**Score: 6/10.** Real jobs flow in. Weather is fake, post-install tracking absent.

---

### VIEWER (11 staff — largest non-operational group)

Pages: `/ops`, `/ops/executive`, `/ops/reports`

Same dashboards as ADMIN with financial values masked to `••••••` via `canViewOperationalFinancials`. Masking covers revenue, AR, builder revenue, AP, cycle-time cost. Viewers see volume (order counts, deliveries) but can't answer "how's the business doing financially?" No viewer-tailored landing — they hit the ADMIN dashboard with holes.

**Score: 6/10.** Acceptable for board/contractor viewers.

---

## Completeness matrix

| Role | Core page | Score | Gap | Fix |
|---|---|---|---|---|
| ADMIN | /ops | 8 | ActivityFeed always empty (0 Activity rows) | Wire login/navigation events to Activity |
| ADMIN | /ops/executive | 8 | Cycle time skewed by premature COMPLETE | Track DELIVERED distinct from COMPLETE |
| ADMIN | /ops/command-center | 7 | NUC agents OFFLINE (hardware not deployed) | Hardware deployment blocker — known |
| ADMIN | /ops/finance | 7 | AP forecast is PO-based not bill-based | Add VendorBill model or use QB liability sync |
| ADMIN | /ops/integrations | 5 | No last-sync timestamp per integration | Add `lastSyncAt` to IntegrationState |
| MANAGER | /ops/kpis | 6 | Quote conversion distorted by 7 test quotes | Delete test-audit-* quotes; filter out testIds |
| MANAGER | /ops/staff | 5 | No lastLoginAt column | Add Staff.lastLoginAt, populate on auth |
| MANAGER | /ops/kpis | 6 | On-time delivery rate = 100% (false) | Require status transition SCHEDULED→IN_TRANSIT→COMPLETE |
| PM | /ops/portal/pm | 5 | "My Jobs" shows all 10 jobs not owner's | Filter by assignedPMId = $staffId |
| PM | /ops/portal/pm | 5 | 573 orphan jobs (no PM) invisible to anyone | Assign default PM on Job create |
| PM | /ops/portal/pm | 5 | "Top Builders" widget uses createdAt sort | Change to ytdRevenue sort |
| PM | /ops/portal/pm | 4 | Task table empty — 0 rows ever | Seed from Job lifecycle or disable widget |
| SALES_REP | /ops/portal/sales/next-stop | 4 | Activity table empty — 0 stops ever | Google Calendar → Activity pipeline |
| SALES_REP | /ops/sales/pipeline | 3 | 2 stalled deals, pipeline is empty | Seed from ECI Bolt export |
| SALES_REP | /ops/quotes | 3 | 6/7 quotes are test data | Purge test quotes |
| ESTIMATOR | /ops/takeoff-tool | 7 | Takeoff → Quote handoff unclear | Audit generator route |
| ESTIMATOR | /ops/takeoff-review | 6 | All takeoffs pre-approved, review empty | Expected but show "caught up" affirmatively |
| ACCOUNTING | /ops/portal/accounting/close | 1 | MonthlyClose table doesn't exist | Create table + migration |
| ACCOUNTING | /ops/collections | 2 | Hides 21 overdue invoices ($49K) | Fix status IN filter: SENT→ISSUED, PARTIAL→PARTIALLY_PAID |
| ACCOUNTING | /ops/finance/ar | 6 | Diverges from collections numbers | Unify via single source query |
| ACCOUNTING | /ops/invoices | 5 | 6 draft invoices not surfaced on overview | Add "Drafts" card to accounting landing |
| PURCHASING | /ops/portal/purchasing/briefing | 6 | Stockouts split across MRP vs briefing | Unify "urgent inventory" view |
| PURCHASING | /ops/inventory/auto-reorder | 6 | ReorderSuggestion never populated | Enable cron — currently dead |
| PURCHASING | /ops/purchasing | 7 | Vendor on-time rate uses nullable actualDate | Backfill actualDate from receivedAt |
| WH_LEAD | /ops/portal/warehouse/briefing | 3 | 6 of 7 KPIs = 0 because tables empty | Seed MaterialPick from Order lifecycle |
| WH_LEAD | /ops/portal/warehouse/briefing | 3 | QC queue always empty (status not used) | Wire READY_FOR_QC transition |
| WH_LEAD | /ops/manufacturing | 4 | Production queue limited to today's schedule | Show next 3 days |
| WH_TECH | /ops/warehouse/pick-scanner | 2 | Job dropdown hardcoded empty (TODO in code) | Wire fetchJobs to real API |
| WH_TECH | /ops/manufacturing/picks | 2 | MaterialPick empty | Same as above |
| DRIVER | /ops/portal/driver | 3 | All deliveries COMPLETE — no future queue | Require SCHEDULED state on Delivery create |
| DRIVER | /ops/delivery/today | 3 | Same root cause | Same |
| DRIVER | /ops/portal/driver | 5 | Builder phone often null | Backfill from BuilderContact |
| QC_INSPECTOR | /ops/portal/qc/queue | 1 | 0 staff in role, 0 inspections, status unused | Full workflow wiring |
| INSTALLER | /ops/portal/installer | 6 | Weather hardcoded | Wire real weather API or remove |
| INSTALLER | /ops/inspections | 3 | 0 Inspection rows | Create post-install inspection entry |
| VIEWER | /ops | 6 | Dashboard is ADMIN-oriented with lots masked | Build viewer landing with unmasked-safe metrics |

---

## Top 10 fixes, ranked by ROI

If exactly one of these gets fixed per week over Q2 2026, Abel OS goes from "system of record" to "system of work" across every role.

1. **Fix Collections filter enum drift.** Change `status IN ('SENT','PARTIAL')` to `status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')` across all Collections queries. Dawn immediately sees the 21 overdue invoices ($49K). **Effort: 1 hour. Impact: accounting goes from 3/10 to 7/10.**

2. **Populate `Delivery` SCHEDULED state.** When a Job transitions to STAGED or MATERIALS_LOCKED, auto-create a Delivery row with status=SCHEDULED and a scheduledDate from the job. Drivers immediately see tomorrow's route. **Effort: half-day. Impact: DRIVER score 3 → 8.**

3. **Create `MonthlyClose` table + migration.** The page already exists. Without the table, Dawn can't close April. Migrate, seed current month, done. **Effort: 2 hours. Impact: enables Dawn's close workflow.**

4. **Filter PM portal "My Jobs" by `assignedPMId`.** One-line fix in the API route or in the UI call. Makes the dashboard actually personal. **Effort: 30 min. Impact: PM portal becomes useful daily instead of a noisy shared view.**

5. **Wire Google Calendar → Activity.** Nate said in CLAUDE.md that Google Workspace is connected. A cron that pulls calendar events containing a known builder's name and writes an Activity row would immediately fill the Next-Stop portal. **Effort: 1 day. Impact: SALES_REP score 4 → 8.**

6. **Seed `MaterialPick` from Order lifecycle.** When an Order transitions to CONFIRMED, generate MaterialPick rows from OrderItems. Warehouse lead's briefing, pick scanner, production queue all light up. **Effort: 1 day. Impact: WH_LEAD 3 → 7, WH_TECH 2 → 6.**

7. **Assign default PM at Job create.** Based on builder → primary PM mapping (or round-robin across active PMs). Eliminates the 573-job orphan pool. **Effort: 2 hours + seed data. Impact: PM portal completeness +30%.**

8. **Purge `test-audit-*` records from Quote, Order, Takeoff.** 7 of 8 quotes are test data skewing manager KPIs. One DELETE query. **Effort: 15 minutes. Impact: manager dashboards become trustworthy.**

9. **Add "Drafts" + "Upcoming AP" cards to Accounting landing.** Surface the 6 draft invoices ($50K) and the top-10 upcoming POs as bills-to-pay. Dawn gets a unified "today" view instead of 4 tabs. **Effort: half-day. Impact: ACCOUNTING 3 → 6.**

10. **Stop marking deliveries COMPLETE on creation.** Whatever cron or endpoint is auto-flipping Delivery.status to COMPLETE needs a scheduled lifecycle: SCHEDULED → LOADING → IN_TRANSIT → COMPLETE. Without this, deliveries are never "in flight" and on-time metrics are false. **Effort: 1 day including UI changes to delivery state machine. Impact: fixes driver portal, manager KPIs, cycle-time math simultaneously.**

Five of these ten are under 4 hours of work. Three of them unlock entire role-portals (drivers, accounting, PMs) that currently show mostly zeros.

---

## Closing observation

The infrastructure is good. The UIs are good. The DB schema is good. **What's missing is the connective tissue between workflows.** Picks don't get generated from orders. Inspections don't get scheduled from jobs. Activities don't get created from calendar events. Deliveries don't stay in motion — they flash into existence already complete.

This is the hallmark of a platform that was built pages-first, data-second. Every role's dashboard works. Half the roles' data flows don't. The 10 fixes above aren't schema changes — they're **write-side wiring** that closes gaps the read-side already knows about.
