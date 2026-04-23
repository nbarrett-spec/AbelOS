# Drift Deep Dive Report

**Run:** 2026-04-22
**Scripts:** `scripts/drift-deep-dive.mjs` (READ-ONLY), `scripts/drift-fix-targeted.mjs` (dry-run + `--apply`).
**Outputs:** `scripts/drift-deep-dive.json`, `scripts/drift-fix-targeted.json`.

---

## Headline

- **13 big-drift (≥$10K) orders** → 10 CORRUPT_HEADER_TRUST_ITEMS (needs Dawn), 3 PARTIAL_IMPORT_TRUST_STORED (stored header self-reconciles; no write needed).
- **441 no-item orders** → 100% stored-field self-reconciling. **Zero writes required.** Split: 328 MANUAL_ENTRY, 77 EMPTY_ORDER, 20 INFLOW_LEGACY, 13 FORECAST_PLACEHOLDER, 3 MIGRATION.
- **0 orphan OrderItems** (both `productId` and `orderId` refs clean). Prior vendor/builder merges did not leave FK rot.

**Auto-fix writes: 0.** Drift cleanup is done for what is safe to automate.

---

## 1. Big-drift orders (13)

Every one of these has a stored header that *internally* reconciles (`subtotal + tax + ship ≈ total`). The drift is between stored-total and `Σ OrderItem.lineTotal`.

### CORRUPT_HEADER_TRUST_ITEMS — 10 orders, $156,611 of at-risk billed revenue

Stored totals look decimal-shifted, truncated, or negative. Items look like real orders (26-38 lines each with tax amounts consistent with ~8% on the items sum). **7 of 10 are Toll Brothers** — strong pattern of a single broken import batch.

| Order # | Builder | Stored Total | Items Sum | # Items | Delta |
|---|---|---:|---:|---:|---:|
| SO-003418 | Joseph Paul Homes | $78.29 | $28,083 | 32 | −$28,011 |
| SO-003455 | Fig Tree Homes | $117.08 | $18,195 | 7 | −$18,087 |
| SO-003580 | Bailey Brothers | $45.23 | $17,831 | 34 | −$17,790 |
| SO-003179 | Toll Brothers | $378.88 | $16,463 | 27 | −$16,113 |
| SO-003521 | Toll Brothers | $455.58 | $15,230 | 26 | −$14,809 |
| SO-003726 | Toll Brothers | $84.80 | $14,613 | 28 | −$14,534 |
| SO-003427 | Toll Brothers | $763.75 | $13,120 | 30 | −$12,415 |
| SO-003239 | Toll Brothers | **−$112.44** | $12,660 | 38 | −$12,764 |
| SO-003443 | Toll Brothers | $657.34 | $11,959 | 26 | −$11,352 |
| SO-003750 | Toll Brothers | $487.32 | $11,187 | 30 | −$10,737 |

**Action: DO NOT auto-fix. Dawn reviews.** Once approved, rebuild header from items per order:
```sql
UPDATE "Order" o SET
  subtotal = (SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id),
  total    = (SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id)
             + COALESCE("taxAmount",0) + COALESCE("shippingCost",0),
  "updatedAt" = NOW()
WHERE id IN (<10 IDs>);
```

### PARTIAL_IMPORT_TRUST_STORED — 3 orders

Stored total looks like a real builder order; items are partial.

| Order # | Stored Total | Items Sum | # Items |
|---|---:|---:|---:|
| SO-000218 | $31,435 | $6,372 | 9 |
| SO-001947 | $12,967 | $750 | 1 |
| SO-000214 | $12,844 | $750 | 1 |

**Action (mission spec):** recompute `total = subtotal + tax + ship` from stored fields. Verified live — all three **already match**, so the fix is a no-op at the header level.

---

## 2. No-item orders (441)

Aggregate stored total: **$1,148,051**. Every one passes `subtotal + tax + ship ≈ total` within $0.01. The audit flagged these for "zero items exist" — not for header drift.

| Classification | Count | $ of stored totals | Action |
|---|---:|---:|---|
| MANUAL_ENTRY | 328 | $787,769 | Leave as-is. No InFlow link, no `isForecast`; manual header-only entries. |
| EMPTY_ORDER | 77 | $0 | Leave as-is. Zero total + zero items — cancellations/placeholders. |
| INFLOW_LEGACY | 20 | $303,533 | Leave as-is. `inflowOrderId` set; stored total is source of truth. |
| FORECAST_PLACEHOLDER | 13 | $53,693 | Leave as-is. `isForecast=true` by design. |
| MIGRATION | 3 | $3,056 | Leave as-is. `subtotal=0, total>0` — pre-line-item legacy. |

Worth flagging for process (not data): the 328 MANUAL_ENTRY orders ($788K) have intact headers but no audit of what the builder actually ordered. Ops portal currently has no friction on saving a zero-line order.

---

## 3. Orphan OrderItem rows

`OrderItem → Product`: **0.** `OrderItem → Order`: **0.** Schema has `onDelete: Restrict` on Product and `Cascade` on Order — and the prior merge work did not bypass it. Clean.

---

## Safe-to-auto-fix vs. needs-Dawn

| Bucket | Count | Action | Needs human? |
|---|---:|---|---|
| CORRUPT_HEADER_TRUST_ITEMS | 10 | Rebuild header from items | **Dawn** |
| PARTIAL_IMPORT_TRUST_STORED | 3 | Already self-reconcile | No |
| INFLOW_LEGACY / FORECAST / EMPTY / MIGRATION | 113 | Leave alone | No |
| MANUAL_ENTRY | 328 | Leave alone (header OK) | UX conversation, not data fix |
| Orphan OrderItems | 0 | None | No |

---

## Recommendation

1. **Dawn reviews the 10 CORRUPT_HEADER orders** — especially the 7 Toll Brothers ones. Pattern screams single-batch import bug. Recovers ~$156K of billable revenue currently hidden.
2. **Everything else is clean.** The auto-repair skipped these exactly as it should have. The "441 no-items" and "13 big-drift" counts from the original audit are not actionable as header drift fixes.
3. **UX follow-up (separate task):** decide whether to block zero-line orders in the ops portal, or add a "reconstruct from delivery notes" backfill job for the 328 MANUAL_ENTRY headers.

---

## Run guide

```bash
node scripts/drift-deep-dive.mjs                 # READ-ONLY; writes scripts/drift-deep-dive.json
node scripts/drift-fix-targeted.mjs              # dry run (default)
node scripts/drift-fix-targeted.mjs --apply      # commit — currently 0 rows
```

Idempotent. No schema changes. No commits. No source routes touched.
