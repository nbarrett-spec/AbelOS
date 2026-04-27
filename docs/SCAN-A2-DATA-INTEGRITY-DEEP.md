# SCAN-A2 — Data Integrity Deep

**Run:** 2026-04-27 — HEAD `171a6b4` — read-only against Neon prod. No mutations.
**Scope:** Beyond `docs/AUDIT-DATA-REPORT.md` (FK orphans). Calc-field staleness, status-enum drift, date anomalies, required-relationship gaps, numeric anomalies, string anomalies, JSONB corruption, duplicates, audit-log gaps.
**Method:** Probe scripts `scripts/_tmp-data-deep-scan.mjs` (+ `2.mjs`, `3.mjs`) — ~80 SQL probes via `$queryRawUnsafe`. Logs at `scripts/_tmp-data-deep-scan*.log`. **Probes deleted post-run.**

---

## TL;DR

**RED — three P0s, four P1s, six P2s.** The single biggest finding is **Order.total cached field is stale on 4180 / 4574 rows (91%)** with $1.7M net dollars off. Every invoice in production lacks an audit-log row (0 / 4124). Five negative-cost POs and 585 negative-total invoices are seed/credit-memo artifacts that need quarantining before AR aging or QB sync amplifies them.

| # | Severity | Finding | Count |
|---|---|---|---|
| F1 | **P0** | `Order.total` stale vs sum(items) — $1.7M net drift | 4180 / 4574 |
| F2 | **P0** | `AuditLog` has 0 Invoice / 0 Order / 0 PurchaseOrder rows ever | 4124 / 4574 / 3827 mutations untracked |
| F3 | **P0** | Negative `Invoice.total` rows misclassified as `PAID` | 585 / 4124 |
| F4 | P1 | `PurchaseOrder.total` stale on 158 POs ($196K abs drift) | 158 / 3827 |
| F5 | P1 | `OrderItem.lineTotal` ≠ qty × unitPrice | 1377 / 22441 |
| F6 | P1 | 639 `OrderItem.quantity` are negative; 490 `unitPrice` negative | 639 + 490 |
| F7 | P1 | 22 active Products with `basePrice < cost` (negative-margin) | 22 |
| F8 | P2 | Job `scheduledDate < createdAt` | 3394 / 3999 |
| F9 | P2 | Job `completedAt < createdAt` | 2974 / 3999 |
| F10 | P2 | 11 active-staff name-pair duplicates (Darlene Haag pattern) | 11 pairs |
| F11 | P2 | 3472 `Product.dimensions` are `{}` (zero populated) | 3472 / 3472 |
| F12 | P2 | 33 `Order.createdAt > updatedAt` and 94 `paidAt < createdAt` | 33 + 94 |
| F13 | P2 | 4 `Invoice.amountPaid > total` (overpaid) — all on negative totals | 4 |

Calc fields that are **clean**: Invoice `balanceDue` (0 / 4124 stale), Invoice `subtotal+tax=total` (1 only), Order `subtotal+tax+shipping=total` (0), InvoiceItem `qty×unitPrice=lineTotal` (0).

---

## P0 findings

### F1 — Order.total cached field stale on 91% of rows ($1.7M net drift)

**Severity:** P0
**Table:** `Neon: Order`
**Evidence:**
```sql
WITH x AS (
  SELECT o.id, o.total AS cached,
         COALESCE(SUM(oi.quantity * oi."unitPrice"),0) AS recomputed
  FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId"=o.id
  GROUP BY o.id, o.total)
SELECT COUNT(*) FROM x WHERE ABS(cached-recomputed) > 0.01; -- 4180
SELECT SUM(cached-recomputed), SUM(ABS(cached-recomputed)) FROM x;
-- net_diff: $1,702,881.07 ; abs_diff: $2,086,474.27
-- sum_cached $7,701,289 vs sum_recomputed $5,998,408
```
- **3821 of 4131** orders that have items disagree (max single-row drift $28K on `SO-003418` cached $78 vs items $28K).
- Drift split by source: `SO_imported` 2939/3248 = 90%, `ORD_native` 0/1, `other` 882/882 = 100%.
- The "other" bucket is ID-prefixed orders (`8a203c64-...`, `cc9b5f97-...`) — 100% drift suggests their cached total was set independently of items at import.

**Impact:** Every revenue-by-order, AR aging by order, builder-revenue-by-period, and InFlow reconciliation report reads the **wrong number** — $7.7M cached vs $6.0M from items, a $1.7M overstatement.

**Fix:** Trust line items (additive, auditable). Recompute `Order.total = subtotal + taxAmount + shippingCost`, `subtotal = SUM(items.lineTotal)`. One-shot migration, then Prisma middleware on `Order` / `OrderItem` to keep them in sync. Touches 4180 rows. **NOT EXECUTED.**

---

### F2 — AuditLog has zero Invoice / Order / PurchaseOrder entries ever

**Severity:** P0
**Table:** `Neon: AuditLog`
**Evidence:**
```sql
SELECT entity, COUNT(*) FROM "AuditLog" GROUP BY entity ORDER BY n DESC;
-- Job:511, GmailSync:225, Staff:113, PMRoster:9, Preferences:6,
-- email_send:4, WarrantyClaim:4, Manufacturing:3, Ai:3, InboxItem:2,
-- AIOrder:2, auth:1, WarrantyPolicy:1, Deal:1, Builder:1
-- Invoice / Order / PurchaseOrder / Payment: 0
SELECT COUNT(*) FROM "AuditLog" WHERE action ILIKE '%INVOICE%' OR action ILIKE '%PAYMENT%'; -- 0
-- Invoice updates last 7d:    4020 (from 4/24 bulk re-issue)
-- AuditLog Invoice 7d:        0
-- Order updates 7d:           4550
-- AuditLog Order 7d:          0
-- PO updates 7d:              3463
-- AuditLog PO 7d:             0
```
- The 511 `Job` audit rows are the `PULTE_CLEANUP` bulk action from 4/26.
- Only 886 audit rows total in the table; first row is **2026-03-24** (table existed less than a month).
- 6 invoice mutation routes call `audit()` (per `Grep`), but rows never persist — either the call is a different table, the helper noops, or the `entity` written is something other than 'Invoice' (none of the 15 distinct entities match).

**Impact:** Worst case for AUDIT-A-MUTATION-SAFETY made real. The 22 ghost-builder invoices, 585 negative-total invoices, 4020 bulk re-issue on 4/24 — no audit trail. If a builder disputes a charge, Abel cannot demonstrate when/who issued or edited it. Stripe payment-link launch will compound the gap.

**Fix:** (1) Verify `src/lib/audit.ts` `logAudit()` actually inserts — likely a try/catch swallowing column-shape errors silently. (2) Backfill `entity='Invoice', action='LEGACY_BACKFILL'` for all 4124. (3) Re-instrument invoice/payment/PO/order mutation handlers; add a launch-readiness probe asserting recent `AuditLog WHERE entity='Invoice'` is non-zero.

---

### F3 — 585 negative-total invoices misclassified as PAID

**Severity:** P0
**Table:** `Neon: Invoice`
**Evidence:**
```sql
SELECT status, COUNT(*), SUM(total) FROM "Invoice" WHERE total < 0
GROUP BY status::text;
-- PAID: 585 rows, sum total: -$66,986.99
-- Min single total: -$5,735.93
-- All 4 amountPaid > total are these (paid=0, total negative => "overpaid")
```
- 585 of 4124 invoices (14%) have negative totals. **All are PAID status.** 
- These are credit-memos imported from QB or InFlow as negative-amount invoices instead of the dedicated credit-memo table.
- 26 corresponding `Payment.amount <= 0` rows (sum -$6.1K) on the same invoices — these are refund/credit transactions misclassified as Payment.

**Impact:** AR-aging hides $67K in credits owed. Stripe `total < 0` would crash payment-link gen; QB sync would push negative invoices, breaking AR sub-ledger. Builder statements show mystery PAID lines with negative totals.

**Fix:** Add Invoice `type` column (`INVOICE | CREDIT_MEMO | REFUND`) or `legacy_credit` bool. Filter UI / Stripe / QB by it. Reclassify the 585 + 26 Payment-as-refund rows.

---

## P1 findings

### F4 — PurchaseOrder.total stale on 158 POs ($196K abs drift)

**Severity:** P1
**Table:** `Neon: PurchaseOrder`
**Evidence:**
```sql
-- 158 / 3827 POs with abs(cached - recomputed) > $0.01
-- Max single drift: PO-003046 cached $462 vs items $3695 ($3232 off)
-- By source: LEGACY_SEED 86/2780, INFLOW 72/910, others 0
-- Net dollar drift $188,318 ; abs $196,042
```
**Impact:** AMP forecasts to Boise, vendor performance metrics, QB AP aging all use these. Less catastrophic than F1 — 95% of POs accurate, $196K vs $1.7M.
**Fix:** Same migration pattern as F1, scoped to PO. ~158 rows.

### F5 — OrderItem.lineTotal ≠ qty × unitPrice on 1377 lines

**Severity:** P1
**Table:** `Neon: OrderItem`
**Evidence:**
```sql
SELECT COUNT(*) FROM "OrderItem" WHERE ABS((quantity * "unitPrice") - "lineTotal") > 0.01;
-- 1377 / 22441 (6%)
```
**Impact:** Per-line price audits, margin-by-line queries inconsistent. Likely InFlow `lineTotal` preserved, but `qty × unitPrice` doesn't reproduce it (rounding, line discounts). Same on 15 POItems.
**Fix:** Trust `lineTotal` (the imported truth); enforce `lineTotal = qty * unitPrice` for new lines via Prisma middleware.

### F6 — 639 OrderItems with negative quantity, 490 with negative unitPrice

**Severity:** P1
**Table:** `Neon: OrderItem`
**Evidence:**
```sql
SELECT COUNT(*) FROM "OrderItem" WHERE quantity < 0; -- 639, max -1
SELECT COUNT(*) FROM "OrderItem" WHERE "unitPrice" < 0; -- 490
```
- Top: `SO-003274` 20 negative lines, `SO-001815` 17, `SO-001846` 15 (sum $-7955).
- All on `DELIVERED` orders.

**Impact:** Same as F3 — return/credit lines imported as negative-quantity OrderItems. Every `SUM(quantity)` for picking/allocation is off.
**Fix:** Add `lineType = 'RETURN' | 'CREDIT' | 'STANDARD'`. Enforce `quantity > 0` for new STANDARD lines.

### F7 — 22 active Products priced below cost

**Severity:** P1
**File:** `Neon: Product`
**Evidence:**
```sql
SELECT COUNT(*) FROM "Product" WHERE "basePrice" < "cost" AND "cost" > 0 AND active = true; -- 22
-- Top 5 examples: BC004685 cost $2,186 / price $0
--                 BC004615 cost $1,003 / price $0
--                 BC004662 cost $647   / price $0
--                 BC000768 (CRATING) cost $568 / price $0
--                 BC000406 cost $552   / price $0
-- Categories: 20 MIN FIRE DOOR(7), Services & Labor(3), Fire-Rated Doors(2), SLAB ONLY(2), …
```
**Impact:** Quote → Order auto-pricing puts these on builder POs at $0. minMargin guard bypassed. Direct revenue leak.
**Fix:** Deactivate the 22 or set `basePrice = cost * (1 + minMargin)`. Quoting UI should refuse `basePrice <= cost`.

---

## P2 findings (data hygiene; no money/data loss)

### F8/F9 — Job scheduledDate / completedAt < createdAt

**Severity:** P2
**Table:** `Neon: Job`
**Evidence:**
```sql
SELECT COUNT(*) FROM "Job" WHERE "scheduledDate" < "createdAt"; -- 3394
SELECT COUNT(*) FROM "Job" WHERE "completedAt"   < "createdAt"; -- 2974
-- 3356 of the 3394 are `created_month = 2026-04`
```
**Impact:** None real — back-dated April 2026 import preserving original schedule/completion dates. Confuses lead-time reports.
**Fix:** Document as historical-import artifact; gate lead-time reports on `createdAt > '2026-04-08'`.

### F10 — 11 active-staff duplicate name pairs

**Severity:** P2
**Table:** `Neon: Staff`
**Evidence:** Same pattern as the Darlene Haag dupe AUDIT-DATA flagged. Active-active dupes:
- Jacob Brown (`jacob.brown@`, `j.brown@`)
- Noah Ridge (`n.ridge@`, `noah.ridge@`)
- Sean Phillips (`sean@`, `s.phillips@`)
- Braden Sadler (`braden@`, `b.sadler@`)
- Dalton Whatley (`dalton@`, `dalton.whatley@`)
- Gunner Hacker (`g.hacker@`, `gunner@`)
- Plus 5 active/inactive pairs (Darlene Haag, Scott Johnson, Dakota Dyer ×3, Chris Poppert, Josh Barrett).

**Impact:** Login confusion, dual notifications, stats double-count, audit splits.
**Fix:** Pick canonical per pair (`firstname.lastname@`), reassign FK refs (Job.assignedPMId, Invoice.createdById, AuditLog.staffId), mark dup `active=false`. Needs Nate's review on which is canonical.

### F11 — Product.dimensions all `{}` (3472 / 3472)

**Severity:** P2
**Table:** `Neon: Product`
**Evidence:** `SELECT count(*) FROM "Product" WHERE dimensions::text = '{}'; -- 3472`
**Impact:** UI shows "0 x 0 x 0". Schema default never overridden by import.
**Fix:** Backfill from `Abel_Catalog_*.xlsx`, or hide the column in UI.

### F12 — Order date inconsistencies

**Severity:** P2
**Table:** `Neon: Order`
**Evidence:**
- 33 rows with `createdAt > updatedAt` (max 41 days difference). Sample: `SO-003707` `createdAt 2026-06-04` (forecast) `updatedAt 2026-04-24`. These are the `isForecast` rows where the imported `orderDate` was misassigned to `createdAt`.
- 94 rows with `paidAt < createdAt` (max 350 days). Sample: `SO-003140` `createdAt 2025-12-11` `paidAt 2024-12-26`. Historical data: paid in 2024, imported as a "new" Order in late 2025.

**Impact:** Same as F8 — historical-import artifact. Distorts days-to-pay metrics.
**Fix:** Use `Order.orderDate` (already in schema, line 591) for business events; reserve `createdAt` for row-insert time.

### F13 — 4 Invoices with amountPaid > total (overpaid) — all on negative totals

**Severity:** P2
**Table:** `Neon: Invoice`
**Evidence:** All 4 are credits (F3): `INV-2026-1015 total -$120 paid $0 balance -$120`, etc. The "overpayment" is mechanical because $0 paid > -$120 total.
**Impact:** None on its own. Symptom of F3.
**Fix:** Resolves with F3.

---

## Clean checks (no findings)

- Invoice `balanceDue = total - amountPaid`: **0 stale / 4124**. Invoice subtotal+tax=total: 1 (INV-2026-0001 DRAFT). Order subtotal+tax+shipping=total: 0. InvoiceItem qty×unitPrice=lineTotal: 0.
- **No status-enum drift.** All Job/Order/Invoice/PO/Quote values match Prisma. PaymentMethod, ScopeType, POCategory clean. PickStatus/QCResult tables empty.
- 0 duplicate Invoice/Job/Order numbers; 0 duplicate Staff/Builder emails; 0 duplicate Vendor codes / Product SKUs.
- 0 emails missing `@` (1 BuilderContact `unknown`). 0 whitespace-only names. 0 short phones.
- 0 InventoryAllocations with qty=0 or no Order/Job link. 0 zero-qty OrderItem/POItem/InvoiceItem.
- 0 orphan Payments. 0 POs without Vendor.
- TrimVendor.rates JSONB clean (all object, all numeric). Invoice.paymentPlanDetails: 20 object / 4104 NULL — matches `paymentPlanOffered=true` exactly.
- 0 Vendor.onTimeRate > 1. 0 Product.minMargin > 1. 0 Invoice OVERDUE-but-balance-zero / PAID-but-balance-positive / DRAFT-but-paidAt-set.

---

## Recommendations

**Pre-launch (Monday-blocking):** F2 (verify `logAudit` persists), F1 (recompute Order.total), F3 (quarantine 585 negative invoices before Stripe/QB).
**Tier-1 (this week):** F4 (recompute PO.total), F6 (negative-qty OrderItem discriminator), F7 (22 below-cost products).
**Tier-2 (queue):** F10 (Staff dupes), F11 (Product.dimensions backfill).

**No data modified.** Probes to be deleted post-run.
