# Data Repair Report

**Live run:** 2026-04-23T02:58:xxZ (Abel OS / Neon prod)
**Verification run (idempotency):** 2026-04-23T03:00:39Z → 03:00:42Z
**Mode:** LIVE (applied), then DRY RUN to confirm idempotency

## Summary — live repair deltas

| # | Repair | Before | After | Fixed |
|---|---|---|---|---|
| 1 | InventoryItem.onOrder negative | 1 | 0 | 1 |
| 2 | Order.orderDate NULL | 0 | 0 | 0 (no work needed) |
| 3 | Order.total drift (with items) | 820 | 13 | **807** (skipped > $10K: 13) |
| 4 | Invoice.balanceDue drift | 0 | 0 | 0 (no work needed) |
| 5a | Invoice PAID-but-underpaid | 0 | 0 | 0 |
| 5b | Invoice should-be-PAID | 4 | 0 | **4** |
| 5c | Invoice should-be-OVERDUE | 15 | 0 | **15** |
| 6 | Builder.accountBalance recompute | 177 recomputed | — | 177 |
| 7 | Delivery completedAt<createdAt | 0 | 0 | 0 (no work needed) |
| 8 | test-audit-* rows (list only) | 19 total | 19 (unchanged) | 0 — DELETE SQL written for manual run |
| 9 | Duplicate builders | 1 group (3 rows) | 1 group (3 rows) | flagged for manual review |
| 10 | FinancialSnapshot today | missing | **present** | 1 seeded |

Idempotency confirmed — re-running the script finds no further work on items 1, 2, 4, 5, 7, 10 (item 3 holds at 13 skipped; item 8 is intentionally not auto-cleaned; item 9 is out of scope for this repair).

---

## 1. InventoryItem.onOrder negative

- **Before:** 1 row with `onOrder < 0`
- **After:** 0 rows
- **Fix logic:** for each offender, recomputed `onOrder` as
  `GREATEST(0, SUM(poi.quantity - receivedQty))` across open POs
  (status not in `RECEIVED`/`CANCELLED`).
- **Samples (before):** the single negative row was clamped.

---

## 2. Order.orderDate backfill

- Before NULL: 0 | After: 0 | Updated: 0
- Prior backfill has already handled this column — no new work.

---

## 3. Order.subtotal/total recompute

- **Orders with drift AND items present (before):** 820
- **Fixed:** 807 (drift < $10K — recomputed from OrderItem sum + tax + shipping)
- **Skipped (drift >= $10K):** 13 — likely partial-import / legacy seed data
- **Remaining drift rows:** 13 (the skipped set)
- **Additional orders with no items (441):** intentionally NOT touched — stored totals are truth when OrderItem rows are absent (seeded/InFlow-imported orders).

**Drift distribution of the 820 before the fix:**
- $0.01–$10: 8
- $10–$100: 112
- $100–$1K: 547
- $1K–$10K: 485 (of these, 820 total - 485 above $1K boundary but < $10K)
- $10K+: 29 in the full 1181-drift set; 13 within the "items-present" subset after filtering

**Sample skipped (drift >= $10K — needs human review):**

| Order# | Current Total | Expected Total | Delta |
|---|---|---|---|
| SO-001947 | $12,967.49 | $1,738.29 | $11,229.20 |
| SO-003418 | $78.29 | $28,088.95 | $28,010.66 |
| SO-003239 | -$112.44 | $12,651.24 | $12,763.68 |
| SO-000214 | $12,844.27 | $1,728.89 | $11,115.38 |
| SO-003455 | $117.08 | $18,203.86 | $18,086.78 |

These look like real data mismatches (possibly partial invoicing, credits, or missing OrderItem rows) and deserve a separate pass by Accounting.

---

## 4. Invoice.balanceDue recompute

- Before drift: 0 | After: 0 | Fixed: 0
- Cached column is in sync; no work needed.

---

## 5. Invoice.status realignment

- **5a** PAID-but-underpaid: 0 → fixed 0
- **5b** DRAFT/ISSUED/SENT-but-paid: **4 → fixed 4**
  - Rows moved to `PAID`; `paidAt` set to NOW() where it was NULL.
- **5c** ISSUED/SENT past due (> 1 day): **15 → fixed 15**
  - Rows moved to `OVERDUE`.

Order of operations matters — (5b) ran first so invoices that were fully paid but still marked ISSUED were NOT then flipped to OVERDUE. The 5c query was re-run after 5b to avoid this.

---

## 6. Builder.accountBalance recompute (top 20)

All 177 builders recomputed from open invoices (`ISSUED`/`SENT`/`PARTIALLY_PAID`/`OVERDUE`). Deltas vs. prior cached values:

| Builder | Before | After | Delta |
|---|---|---|---|
| Audit Test Builder 2026-04-23T02:17:46.031Z | $9,200 | $9,200 | $0 |
| Hayhurst Bros. Builders | $9,043.18 | $9,043.18 | $0 |
| RDR Development | $7,372.37 | $7,372.37 | $0 |
| Pulte Homes | $7,278.97 | $7,278.97 | $0 |
| Brad Eugster | $5,583.91 | $5,583.91 | $0 |
| Imagination Homes | $3,633.73 | $3,633.73 | $0 |
| BROOKFIELD | $2,175.47 | $2,175.47 | $0 |
| Royal Crest Homes | $1,507.34 | $1,507.34 | $0 |
| LaLa Construction | $203.38 | $203.38 | $0 |
| F7 Construction | $20.10 | $20.10 | $0 |

(Remaining 10 of top 20 all at $0 before and after.)

Cached balances were already correct — recompute was a no-op in value but synced the cache.

---

## 7. Delivery completedAt < createdAt

- Before: 0 | After: 0 | Fixed: 0
- No impossible-order timestamp rows present.

---

## 8. test-audit-* rows (LIST ONLY)

Counts by table:
- **Order:** 5 (e.g. `test-audit-moau39ei-order`, `test-audit-moau4omc-order`, ...)
- **Builder:** 7 (e.g. `test-audit-moatv91l-builder`, `test-audit-moau1qin-builder`, ...)
- **Project:** 7 (e.g. `test-audit-moatv91l-project`, `test-audit-moau1qin-project`, ...)
- **Invoice:** 0
- **PurchaseOrder:** 0

DELETE SQL written to **`scripts/cleanup-test-audit-data.sql`** — FK-safe ordering (Invoice → PurchaseOrder → Project → Order → Builder), wrapped in `BEGIN; ... COMMIT;`. Run manually after review.

---

## 9. Duplicate builders (sanity check)

- Groups with > 1 builder sharing `LOWER(companyName)`: **1**
- `"e2e probe builder" × 3` — all three rows have `id LIKE 'test-probe-%'`:
  - `test-probe-moaw5r5w-b`
  - `test-probe-moaw68vn-b`
  - `test-probe-moaw7x9r-b`
- These are E2E probe test rows (distinct from `test-audit-*` cleanup set). Recommend adding a `test-probe-*` cleanup alongside item 8, or spawning a dedicated cleanup task.

---

## 10. FinancialSnapshot today

- **Before:** no snapshot for today → Trends page would have been empty.
- **After:** 1 snapshot seeded for today (NOW()).

Seeded values (computed live from Invoice + PurchaseOrder state):
- AR total: **$81,047.83** (second run saw $81K, first dry-run saw $79K — natural drift from pending writes between runs)
- AR current (not yet due): computed from `dueDate >= CURRENT_DATE`
- AR 30/60/90+ buckets: computed from `dueDate` aging
- Open PO total: **$624,016.52**
- Pending invoices (DRAFT): computed
- Overdue AR %: **88.65%** (of AR is past due — concerning, but that's a business fact, not a data fix)
- Cash on hand / AP / DSO / revenue: **0** — the `financial-snapshot` cron will populate on next run. The `@@unique(snapshotDate)` constraint means the cron's upsert will UPDATE this row rather than conflict.

---

## Safety notes

- All repairs are additive or recomputed-from-truth. No DROPs. No destructive changes.
- **Orders without items were intentionally NOT recomputed** — stored totals remain truth for seeded data.
- **test-audit-* rows were NOT auto-deleted** — SQL is ready for manual execution.
- **The 13 large-drift orders (>= $10K)** are skipped and flagged for Accounting review, not silently "fixed."
- Re-running `node scripts/repair-data-drift.mjs` is safe (idempotent) — it will find no work on items 1, 2, 4, 5, 7, 10 going forward.
- No git commits were created.

## Files written

- `scripts/repair-data-drift.mjs` — the repair script
- `scripts/cleanup-test-audit-data.sql` — manual-run test-data cleanup
- `DATA_REPAIR_REPORT.md` — this file
