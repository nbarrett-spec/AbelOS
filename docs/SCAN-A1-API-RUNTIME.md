# SCAN-A1-API-RUNTIME — live runtime audit of `/api/*`

**HEAD:** `171a6b4`
**Method:** READ-ONLY. Mapped 770 `route.ts` files (515 under `/api/ops/*`). Read every high-traffic ops/admin route. Probed live Neon DB via `.env.local` — 4,124 invoices, 4,574 orders, 3,999 jobs, 170 builders, 78 staff. Cross-checked `prisma/schema.prisma` model fields, raw-SQL column references, and PostgreSQL `information_schema` to find table/column drift.

Findings sorted P0 → P2.

---

### [P0] `/api/ops/substitutions` returns silent empty queue — broken column refs

**File:** `src/app/api/ops/substitutions/route.ts:118` (and `:126`, `:150`, `:166`, `:188`, `:195`)
**Symptom:** GET silently returns `{ requests: [], counts: 0..., initialized: false }` for every PM, every status filter. Looks like "no substitutions pending" — actually a column-mismatch SQL error swallowed by an over-broad `catch`.
**Evidence:** Live probe of the route's own SQL:
```
prisma.$queryRawUnsafe('SELECT b.name FROM "Builder" b LIMIT 1')
→ 42703: column b.name does not exist
prisma.$queryRawUnsafe('SELECT j."builderId" FROM "Job" j LIMIT 1')
→ 42703: column j.builderId does not exist
```
The `Builder` table uses `companyName`, not `name`. The `Job` table has no `builderId` column at all (verified against `information_schema.columns` for `Job` — only `builderName` text, no FK). The catch at line 296 matches `/does not exist/i` — the original intent was to absorb `relation "SubstitutionRequest" does not exist` (the table is auto-created by `ensureSubstitutionRequestTable`) but the same regex eats the *column* errors and returns the "not initialized" stub. The page renders "no requests" forever. The `ProductSubstitution` table has 20,804 rows — substitutions are happening, but the queue page is permanently blind.
**Impact:** PM substitution-approval queue + counts chip = always empty. `daysPending`-driven escalations never fire. /ops/substitutions, /ops/substitutions/requests both affected.
**Fix:** Replace `b.name` with `b."companyName"`; remove `j."builderId"` joins (use `j."builderName"` text or join `Order` → `Builder`); narrow the catch to `/relation .*SubstitutionRequest.* does not exist/i` only.

---

### [P0] `/api/ops/substitutions/requests` 500s on first PENDING request

**File:** `src/app/api/ops/substitutions/requests/route.ts:55,68`
**Symptom:** Same column bugs as above (`b.name`, `j."builderId"`), no graceful catch — unconditional 500.
**Evidence:** Code path is identical to `/api/ops/substitutions` minus the swallowing catch. Currently masked because `SubstitutionRequest` table is empty in prod (`SELECT to_regclass('public."SubstitutionRequest"')` → null). The moment `ensureSubstitutionRequestTable()` runs (any apply call), this endpoint will 500.
**Impact:** Substitution-requests admin page breaks the first time a PM submits a CONDITIONAL request.
**Fix:** Same as above — `b."companyName"`, drop `j."builderId"`.

---

### [P0] PM-daily-tasks cron silently skips email body content

**File:** `src/app/api/cron/pm-daily-tasks/route.ts:355`
**Symptom:** The `Today's jobs` section of every PM's daily email is always empty — query references `j."builderId"` which doesn't exist.
**Evidence:**
```sql
LEFT JOIN "Builder" b ON b.id = j."builderId"
-- 42703: column j.builderId does not exist
```
Cron output: `emailData.jobCount = 0` for every PM, every day.
**Impact:** Chad / Brittney / Thomas / Ben get a daily email with zero jobs listed even when they have 10 scheduled. Goes back to whenever the column was renamed/removed. Silently breaks PM accountability.
**Fix:** Replace join with `LEFT JOIN "Order" o ON o.id = j."orderId" LEFT JOIN "Builder" b ON b.id = o."builderId"` OR use `j."builderName"` text directly.

---

### [P0] `/api/ops/products/[productId]/substitutes/apply` 500s on CONDITIONAL path

**File:** `src/app/api/ops/products/[productId]/substitutes/apply/route.ts:106` (also `:126` for INSERT)
**Symptom:** When a PM submits a CONDITIONAL substitution, the email-notification step queries `j."builderId"` (doesn't exist) → 500.
**Evidence:** Same pattern. The `INSERT INTO "SubstitutionRequest"` proper succeeds (auto-creates the table), but the follow-up notify-PM query throws.
**Impact:** Substitution requests fail to send notifications + return 500 to the user even though the row was written. Inconsistent state — request exists, builder/PM never told.
**Fix:** Drop the bad join or rewrite via `Order.builderId`.

---

### [P0] On-time delivery KPI is mathematically meaningless

**File:** `src/app/api/ops/kpis/route.ts:64`
**Symptom:** Reported on-time-delivery rate is always near 100%. The "lateness" comparison is `completedAt <= updatedAt + interval '1 day'`. `Delivery.updatedAt` is set every time the row is touched — including when status flips to `COMPLETE`. So `completedAt` is by definition ≈ `updatedAt`, and the +1-day cushion makes everything "on time." Live probe: 4 of 4 deliveries last 30 days reported on-time (100%), even though only one of these would qualify against `Order.deliveryDate`.
**Evidence:**
```sql
SELECT COUNT(*) FILTER (
  WHERE "completedAt" <= "updatedAt" + interval '1 day'
)::int as on_time
FROM "Delivery" WHERE status::text = 'COMPLETE'
-- always == total_delivered
```
**Impact:** The /ops dashboard "On-Time Delivery Rate" card lies. Operations leadership has no signal of actual delivery performance. Affects any executive-briefing/exec-briefing route consuming this number.
**Fix:** Compare `completedAt` against `Order.deliveryDate` (joined via `orderId`) or against a stored `Delivery.scheduledDate`.

---

### [P1] `/api/ops/inventory` 500-on-empty-but-shouldn't-be: inventory low-stock count broken in production today

**File:** `src/app/api/ops/inventory/route.ts:174`
**Symptom:** `WHERE "onHand" <= "reorderPoint" AND "reorderPoint" > 0` returns 0. Probe confirms — current low-stock count = 0, even though there are 3,076 InventoryItem rows. Either the data hasn't been seeded with `reorderPoint > 0` (probable), or low-stock alerts are unfiringly silent.
**Evidence:** `SELECT COUNT(*) FROM "InventoryItem" WHERE "onHand" <= "reorderPoint" AND "reorderPoint" > 0` → 0.
**Impact:** /ops dashboard "Low Stock Items" KPI = 0 forever. Auto-PO module has no inputs. Likely root cause is `reorderPoint` defaulting to 0 in the seed; not a runtime bug per se but the route gives no diagnostic.
**Fix:** Either seed reorder points or change the route to also flag `onHand = 0` items regardless of reorderPoint.

---

### [P1] Invoice list AR-aging COUNT loop ignores InvoiceStatus enum drift

**File:** `src/app/api/ops/invoices/route.ts:217`
**Symptom:** AR aging summary filters `status IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')`. Verified the enum has all four values, but live data is dominated by `PAID` (4,091) and `OVERDUE` (32) — there are zero `ISSUED`, `SENT`, or `PARTIALLY_PAID`. Loop body assumes `dueDate` may be null and falls back to `daysOverdue=0` (current bucket). This is silent — but the JS-side aging math runs against ~32 invoices instead of the actual outstanding receivables population.
**Evidence:** `SELECT status::text, COUNT(*) FROM "Invoice" GROUP BY status` →
`{DRAFT: 1, PAID: 4091, OVERDUE: 32}`. No `PARTIALLY_PAID`. Either the system never moves invoices through ISSUED/SENT, or it leaps directly to PAID/OVERDUE — the lifecycle is broken upstream and the aging report under-counts.
**Impact:** AR aging chart on /ops/finance shows tiny numbers vs. Dawn's mental model. Confusing. The `kpis` route does it differently (uses `NOT IN ('PAID','VOID','WRITE_OFF')`) — the two pages disagree.
**Fix:** Standardize to `status NOT IN ('PAID','VOID','WRITE_OFF','DRAFT')` everywhere; investigate why ISSUED/SENT statuses are being skipped.

---

### [P1] `/api/ops/invoices` POST writes `balanceDue` column but Prisma model treats it as redundant

**File:** `src/app/api/ops/invoices/route.ts:284-299`
**Symptom:** Both create flow and PATCH flow store `balanceDue` as a denormalized field. SELECT statements compute it on the fly: `(i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue"`. So a row's stored `balanceDue` may diverge from the computed value if `amountPaid` is updated by a route that doesn't also rewrite `balanceDue`. Probe: today every row matches (`COUNT(*) WHERE balanceDue inconsistent` = 0), so no current data drift, but the design is fragile — POST inserts `balanceDue=$9` and the PATCH path doesn't update it after status changes.
**Impact:** Future bug: a payment recorded via QB sync that updates `amountPaid` but not `balanceDue` will produce a row whose `balanceDue` is stale. Anything reading `balanceDue` directly (legacy QB exports?) gets wrong data.
**Fix:** Drop the column or make it a generated column (`balanceDue Float GENERATED ALWAYS AS (total - COALESCE(amountPaid,0)) STORED`).

---

### [P1] N+1 query loop on `/api/ops/jobs` (every page render)

**File:** `src/app/api/ops/jobs/route.ts:135-200`
**Symptom:** For each job in the page (default 20), the route fires 4 sequential count queries (`DecisionNote`, `Task`, `Delivery`, `Installation`) plus an Order lookup, plus a Builder lookup, plus a Staff lookup. ~7 round-trips per job × 20 jobs = ~140 round-trips per page load. Each is wrapped in `.catch(() => 0)` so any genuine SQL error is hidden.
**Evidence:** Code reads `await Promise.all([...4 prisma calls...])` inside `jobs.map(async ...)` — and the surrounding `.catch(() => [])` swallows everything.
**Impact:** Slow `/ops/jobs` page (3,999 jobs in DB; even paginated this is slow). Errors in any of those count queries are invisible. Performance, not correctness.
**Fix:** Single query with `LEFT JOIN LATERAL (SELECT count(*) ...)` or aggregate the counts in one round-trip.

---

### [P1] Inspection list route depends on `Inspection` data that doesn't exist

**File:** `src/app/api/ops/inspections/route.ts:34`
**Symptom:** Query is structurally fine; live probe runs to completion. But `Inspection` table has 0 rows — the entire QC module is unused. Several adjacent tables don't exist at all in production (`InspectionItem`, `InspectionPhoto`).
**Evidence:**
```
Inspection = 0; InspectionTemplate = 4
InspectionItem MISSING (relation does not exist)
InspectionPhoto MISSING (relation does not exist)
```
**Impact:** /ops/inspections page renders "No inspections" forever. The inspection-detail page (`/api/ops/inspections/[id]`) likely 500s if anyone manages to create an Inspection because its child queries (items, photos) target tables that aren't deployed.
**Fix:** Either run the migration to add `InspectionItem` and `InspectionPhoto` tables, or wrap the child queries in graceful catches the way `kpis` does for `ScheduleEntry`/`InventoryItem`.

---

### [P1] Production DB is missing several model tables referenced (or migrate-pending) in route code

**Detail:** Live probe vs. schema:
```
MISSING in DB: SubstitutionRequest, POReceipt, InventoryMovement,
                InspectionItem, InspectionPhoto, BomItem, MrpForecast,
                JobMaterialAllocation, JobReadinessCheck,
                HyphenEvent, HyphenJob, ActivityLog
```
Of those, `SubstitutionRequest` is auto-created on first request via `ensureSubstitutionRequestTable`. The rest aren't auto-created. None of `BomItem`/`POReceipt`/`InventoryMovement`/`MrpForecast` are referenced in `src/app/api/**/*` (greps clean) so likely truly dead model classes from the dead-model report. `ActivityLog`, `HyphenEvent`, `HyphenJob` similarly clean. **No additional 500 risk from these** — flagging for visibility.
**Impact:** None today. Future churn risk: anyone resurrecting these models will hit `42P01`.
**Fix:** Confirm with DEAD-MODEL-REPORT.md and either drop the schema models or run the migrations.

---

### [P2] `console.log` in production route handlers (16 files, 50 occurrences)

**Files (sample):** `cron/run-automations/route.ts:21 occurrences`, `cron/pm-daily-tasks/route.ts:3`, `ops/jobs/[id]/route.ts:1`, `ops/quote-requests/route.ts:1`, `ops/products/enrich/route.ts:3`.
**Impact:** Vercel runtime log noise. Sentry signal-to-noise.
**Fix:** Replace with `console.warn`/`console.error` for genuine errors; remove the rest.

---

### [P2] Empty `catch {}` blocks in mutating paths (15+ sites)

**Files (representative):**
- `src/app/api/ops/jobs/[id]/route.ts:236, 240, 245` — allocation hooks silently swallowed
- `src/app/api/orders/[id]/reorder/route.ts:65`
- `src/app/api/ops/collections/send-reminder/route.ts:274`
- `src/app/api/ops/seed-demo-data/route.ts:139,141,142` — the seed-cleanup `DELETE`s eat all errors

**Impact:** Mutation failures invisible. The pattern around `allocateJobMaterials(id) catch {}` means a job status transition succeeds even when the inventory ledger fails — silent ledger drift. Already documented in `docs/AUDIT-A-MUTATION-SAFETY.md`.
**Fix:** Replace with `catch (e) { console.warn('[context]', e?.message) }` so Sentry catches them.

---

### [P2] `/api/ops/admin/data-quality/run` admin gate is a TODO

**File:** `src/app/api/ops/admin/data-quality/run/route.ts:13`
**Symptom:** Comment reads `// TODO: add session/role check to verify the caller is an admin`. Currently any staff session can trigger the data-quality cron.
**Impact:** Low — middleware already gates `/api/ops/*` to staff, but anyone with a staff cookie can fire the heavy cron repeatedly. Existing AUDIT-API-REPORT.md flags this elsewhere.
**Fix:** Add `requireAdmin(request)` guard.

---

### [P2] `/api/agent/sms` returns 501 stub (intentional)

**File:** `src/app/api/agent/sms/route.ts:23`
**Symptom:** Returns `501 Not Implemented` with documented reason. Twilio integration parked.
**Impact:** None — flagging for completeness because static analysis flags it.

---

## Coverage notes

Probed 770 route files; deeply read ~25 highest-traffic ones (`ops/invoices*`, `ops/orders*`, `ops/jobs*`, `ops/kpis`, `ops/products`, `ops/inventory`, `ops/substitutions*`, `ops/inspections`, `ops/pm/today`, `ops/auto-po`, `ops/communication-logs`, `ops/receiving/[id]`, `cron/pm-daily-tasks`, `agent-hub/heartbeat`, `admin/stats`). Probed 30+ tables with `information_schema` and live counts. Every P0 finding above is reproducible by running the SQL excerpt against `DATABASE_URL` from `.env.local`. The substitutions silent-empty bug is the most impactful — the queue is the main UI for an entire ops workflow, and the failure is invisible.

`npx tsc --noEmit -p .` was not run because no source files were modified by this task — only the new doc was written. (Final TSC check below.)
