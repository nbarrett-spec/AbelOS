# AUDIT-DATA Report

**Run:** 2026-04-24 — HEAD `6169e25` — read-only against Neon prod. No mutations.
**Scope:** FK integrity, zombie locks, business-logic anomalies, recent-activity gaps.

---

## Summary table — model | total | orphan | severity

| Model | total | orphan / FK issues | severity |
|---|---:|---|---|
| Builder | 170 | — | OK |
| Project | **1** | — | dormant (legacy: orders skip Project/Quote) |
| Quote | **1** | — | dormant |
| Order | 4574 | 0 builderId / 0 quoteId orphans | OK |
| OrderItem | 22441 | 0 productId orphans | OK |
| Job | 3999 | 0 assignedPMId / orderId / communityId orphans | OK on FKs |
| Invoice | 4124 | **22 builderId orphans** (3 ghost builderIds) | **HIGH** |
| InvoiceItem | 146 | 0 invoiceId orphans | OK on FKs |
| PurchaseOrder | 3827 | 0 vendorId orphans | OK |
| PurchaseOrderItem | 8146 | 0 PO / productId orphans | OK |
| Vendor | 80 | — | OK |
| Staff | 78 | — | OK |
| Product | 3472 | productType: 0 NULL (3370 PHYSICAL / 102 LABOR) | OK |
| InventoryAllocation | 4312 | 0 jobId / productId / orderId orphans | OK |
| MaterialPick | **0** | — | OK (table empty in prod) |
| CommunicationLog | 1867 | 0 builderId orphans | OK |
| CronRun | 8314 | — | OK (30/30 jobs SUCCESS today) |
| Payment | 4602 | 0 invoiceId orphans | OK |

**FK integrity is excellent.** Every relation declared with `@relation` in `prisma/schema.prisma` is clean. The only orphan signal is on the **un-FK'd** `Invoice.builderId` (schema line 1848: `// Builder relation not added to keep migration simple`).

---

## Top 10 most-concerning anomalies

### 1. Invoices with no line items: **4020 / 4124 (97.5%)** — all PAID
```sql
SELECT bucket, status, COUNT(*) FROM (SELECT i.id, i.status::text AS status,
  CASE WHEN EXISTS (SELECT 1 FROM "InvoiceItem" ii WHERE ii."invoiceId"=i.id)
       THEN 'HAS_ITEMS' ELSE 'NO_ITEMS' END AS bucket FROM "Invoice" i) x
GROUP BY bucket, status;
-- HAS_ITEMS: 71 PAID, 32 OVERDUE, 1 DRAFT
-- NO_ITEMS:  4020 PAID
```
Looks like seed-imported historical invoices that never carried line items. All 4020 are PAID, so no UX is breaking right now — but anything joining Invoice → InvoiceItem for revenue-by-product or labor reporting reads near-zero.

### 2. Orphan `Invoice.builderId` — 22 invoices point at 3 ghost Builder IDs
```sql
SELECT "builderId", COUNT(*) FROM "Invoice"
 WHERE "builderId" NOT IN (SELECT id FROM "Builder") GROUP BY "builderId";
-- cmmzruo7q029o93oppxwad5zs : 19
-- cmmzrumbv028o93op5n6atwl8 : 2
-- cmmzrulpd028a93opehwtn9vt : 1
```
All 22 are Feb–Mar 2026 (status mix: OVERDUE / PAID / DRAFT). Ghost IDs share the `cmmzru…93op` legacy-Pulte seed prefix. Collections UIs joining Invoice → Builder will fail or render "Unknown" for these.

### 3. **Pulte zombies — 246 COMPLETE jobs** (mission flagged 252)
```sql
SELECT COUNT(*) FROM "Job" j
 WHERE LOWER(j."builderName") ~ 'pulte|centex|del webb' AND j.status::text = 'COMPLETE';
-- 246
```
By denormalized name: 246 COMPLETE + 4 CREATED + 2 IN_PRODUCTION + 1497 CLOSED = 1749 Pulte-tagged jobs total. Via `Order.builderId → Builder.companyName`, only 151 of the COMPLETEs are reachable — the other 95 have no live order link. The 6-job delta from Nate's "252" is plausibly drift since last count.

### 4. Pulte jobs with active PM assignment — **157**, not 11
```sql
SELECT COUNT(*) FROM "Job" j
 WHERE LOWER(j."builderName") ~ 'pulte|centex|del webb'
   AND j."assignedPMId" IS NOT NULL
   AND j.status::text NOT IN ('CLOSED','INVOICED');
-- 157
```
Brittney Werner alone owns 137 COMPLETE Pulte jobs + 4 CREATED + 2 IN_PROD. Other PMs total 14 COMPLETE Pulte assignments (Clint 3, Scott 3, Robin 2, Darlene 2, Jessica 2, Sean 1, Karen 1) — that "14" is closest to the "11 misassigned" Nate referenced.

### 5. **20 active jobs assigned to inactive Staff**
```sql
SELECT COUNT(*) FROM "Job" j JOIN "Staff" s ON s.id = j."assignedPMId"
 WHERE s.active = false AND j.status::text NOT IN ('CLOSED','INVOICED');
-- 20
```
Owners: Scott Johnson (5), Darlene Haag (4), Jessica Rodriguez (4), Robin Howell (3), Jordan Sena (2), Karen Johnson (2). PM dashboard is showing tasks owned by users who don't log in.

### 6. Zero/negative totals: **608 Invoices**, **435 Orders**, **393 POs**
```sql
SELECT COUNT(*) FROM "Invoice" WHERE total <= 0;       -- 608
SELECT COUNT(*) FROM "Order"   WHERE total <= 0;       -- 435
SELECT COUNT(*) FROM "PurchaseOrder" WHERE total <= 0; -- 393
```
PO breakdown is mostly benign: **368 of 393 are `source = 'LEGACY_SEED'`** (pre-import bulk records). The Order and Invoice zeros need triage; recent invoices include `total = -5735.93` and `total = 0` PAID rows that look like credit memos imported as invoices.

### 7. **Job community vs communityId mismatch — 901 jobs**
```sql
SELECT COUNT(*) FROM "Job"
 WHERE "community" IS NOT NULL AND "communityId" IS NULL; -- 901
SELECT COUNT(*) FROM "Job"
 WHERE "community" IS NULL AND "communityId" IS NOT NULL; -- 0
```
Asymmetric: 901 jobs have a `community` *name* but no FK to Community. 0 the other way. Silently breaks community-rollup queries; likely also drives the Brookfield Hyphen "0/80 linked" symptom.

### 8. **Last `Payment.receivedAt` = 2026-03-23** (32 days stale)
```sql
SELECT MAX("receivedAt") FROM "Payment"; -- 2026-03-23
-- Recent weeks: 3/23 n=45 $66K, 3/16 n=18 $14K, 3/9 n=46 $53K, 3/2 n=2 -$5.7K, 2/23 n=38 $41K
```
Nothing inserted to Payment since 3/23. Could be Stripe webhook handler not writing, QB-sync not pulling, or genuinely zero April payments. collections-cycle cron is green daily — suggests a writer issue.

### 9. **`Invoice.issuedAt` 32 days stale** (last = 2026-03-23) but `createdAt` recent (4/23)
Recent invoices are being created without `issuedAt` populated — likely seed/import path skipping the issue step. Distorts AR aging reports.

### 10. **Project = 1, Quote = 1, Orders with quoteId = 1**
The Project → Quote → Order pipeline is dormant; 4574 orders flow direct from InFlow. Not a data-integrity issue, but any UI filtering `WHERE quoteId IS NOT NULL` will show empty.

---

## Recent activity gaps

| Source | Latest record | Days stale | Verdict |
|---|---|---:|---|
| `Order.createdAt` / `orderDate` | 2026-06-04 (forecast) | future | OK — `isForecast` planning rows |
| `Job.createdAt` / `completedAt` | 2026-04-22 / 04-23 | 1–2 | OK |
| `Invoice.createdAt` | 2026-04-23 | 1 | OK |
| `Invoice.issuedAt` | 2026-03-23 | **32** | **stale** |
| `PurchaseOrder.createdAt` / `orderedAt` | 2026-04-23 | 1 | OK |
| `CommunicationLog.sentAt` | 2026-04-24 17:56 | minutes | OK (gmail-sync canary green) |
| `Payment.receivedAt` | **2026-03-23** | **32** | **stale — anomaly #8** |
| `Builder.createdAt` | 2026-04-23 | 1 | OK |

**CronRun:** all 30 named jobs ran SUCCESS in last 24 h. Zero FAILED in last 14 days. Crons themselves are fine; the gap is in what they don't write.

---

## 252 Pulte zombies — recommended cleanup SQL (review only, NOT EXECUTED)

```sql
-- Step 1 (DRY): verify scope (~246)
SELECT j.id, j."jobNumber", j.status::text, j."completedAt"
  FROM "Job" j
 WHERE LOWER(j."builderName") ~ 'pulte|centex|del webb'
   AND j.status::text = 'COMPLETE'
   AND j."completedAt" < NOW() - INTERVAL '7 days';

-- Step 2 (after Nate sign-off): close them
UPDATE "Job"
   SET status = 'CLOSED', "updatedAt" = NOW()
 WHERE LOWER("builderName") ~ 'pulte|centex|del webb'
   AND status::text = 'COMPLETE'
   AND "completedAt" < NOW() - INTERVAL '7 days';

-- Step 3: unassign PMs from CLOSED/COMPLETE Pulte work post-account-loss
UPDATE "Job"
   SET "assignedPMId" = NULL, "updatedAt" = NOW()
 WHERE LOWER("builderName") ~ 'pulte|centex|del webb'
   AND status::text IN ('CLOSED','COMPLETE');
```
Open Pulte orders match: `IN_PROD n=2 $2,168.37 + RECEIVED n=24 $24,781.06 = 26 / $26.9K` (vs. CLAUDE.md's 21 / $32.5K — gap is likely already-CANCELLED rows).

---

## Recommendations

### Safe to auto-clean (low risk)
1. **Null out the 20 inactive-staff Job assignments.** Gate: `Staff.active = false AND Job.status NOT IN (CLOSED,INVOICED)`. Either NULL or default-PM.
2. **Backfill `Job.communityId` from `Job.community` text** — 901 rows. Match `Community.name + builderId`. Reversible.
3. **Past-due unflagged invoice (1)** — collections-cycle should sweep next run.

### Needs Nate's review
1. **22 orphan `Invoice.builderId`.** Repoint to surviving Pulte/Legacy Builder, or leave + UI fallback. Then add `@relation` to schema.
2. **246 Pulte zombie COMPLETEs** — bulk transition to CLOSED per SQL above.
3. **4020 PAID-no-items invoices** — confirm seed-data intent. If unintended, reconcile InvoiceItem from InFlow/QB.
4. **Payment table 32 days stale** — investigate Stripe + QB writers. Confirm with Dawn or fix the writer.
5. **608 zero/negative Invoices + 435 zero/negative Orders** — quarantine or tag `legacy_seed = true`.

### Schema/code adds (no data change)
- Add `@relation` for `Invoice.builderId → Builder.id` in `prisma/schema.prisma` (no FK exists in DB either — that's how the orphans got in).
- Add a recurring data-quality rule alerting when `Job.assignedPMId` references inactive Staff.

---

**No data modified during this audit.** Temp script `scripts/_tmp-data-audit.mjs` deleted post-run.
