# SCAN-D — Data Integrity vs InFlow source-of-truth (Pre-Brain-Ingest Gate)

**Date:** 2026-04-29
**Mode:** Read-only — no DB writes. Sampled InFlow exports + read 5 reconcile scripts + cross-referenced prior audits (A2, A4, A8, AEGIS-FINANCIAL-RECON, INFLOW-COST-GAP).
**Purpose:** Decide which Aegis tables are TRUSTED, which need RECONCILE, and which are KNOWN_BAD — **before** the NUC Brain starts ingesting them. Garbage-in / garbage-out risk is real: Brain consumes events from `Order`, `Invoice`, `Product`, `InventoryItem`, `PurchaseOrder`, etc. and a stale `Order.total` will poison every Brain finding.

---

## TL;DR

**Ready-to-Brain-Ingest score: 42 / 100.**

- Two cached-aggregate fields (`Order.total`, `PurchaseOrder.total`) are **so wrong** that any Brain-side revenue / margin / spend finding will be garbage. **Block ingest of Order + PO into Brain until F1/F4 from SCAN-A2 are fixed.**
- Catalog/inventory/BOM data is largely TRUSTED (InFlow cron is healthy: last sync 04-27 15:30, 0 record-failures last 6 runs).
- Negative-total invoices (585 rows = 14% of Invoice) are misclassified as PAID — Brain will read $-67K of "paid revenue" as good revenue.
- AR baseline gap of $-195K (-73%) vs the AR report ETL means **AR/finance Brain features are unsafe**.
- AuditLog is empty for Invoice/Order/PO/Payment — **Brain has no provenance trail for any state change.**

**Recommended posture:** ingest Product / InventoryItem / BomEntry / Vendor / Builder / Job NOW (with caveats). **Hold** Order, OrderItem, Invoice, Payment, PurchaseOrder ingest until W1 wave from SCAN-CONSOLIDATED lands.

---

## 1. InFlow source-of-truth shape (sampled)

| File | Rows | Headers (key) |
|---|---:|---|
| `InFlow_Upload_ProductDetails.csv` | 2,513 | `SKU,ProductName,IsActive,Cost` (sparse upload-template — only 4 fields) |
| `InFlow_Upload_StockLevels.csv` | 3,035 | `SKU,ProductName,Location,Sublocation,Quantity` |
| `Abel_InFlow_Price_Import.csv` | 249 | per-customer pricing matrix (Pulte / Brookfield / Toll / etc.) |
| `inFlow_BOM (8).csv` (4/23) | 8,201 | `FinishedProduct,FinishedProductSKU,ComponentProduct,ComponentProductSKU,Quantity,QuantityUom,IsActive` |
| `inFlow_Customer (5).csv` (4/23) | 91 | full customer CSV w/ contact, billing, terms, sales rep |
| `inFlow_PurchaseOrder (13).csv` (4/23) | 17,503 line-items | full PO export w/ vendor, line items, dates, status |
| `inFlow_SalesOrder (16).csv` (4/9) | 59,044 line-items | full SO export — line items, customer, payment status |
| `inFlow_Operations (4).csv` (4/23) | 1,830 | `ProductName,OperationType,OperationPerUnitCost,...` (manufacturing labor steps) |
| `inFlow_ProductDetails (13).csv` (4/23) | 3,386 | full product catalog — `Cost`, `VendorPrice`, `Category` |

**Key observations:**
- The two "Upload_*" CSVs at workspace root (4/12) are **import templates** — they're skinny (4-5 cols), not the full export. Use the `Downlods/Downloads/` `(13)` series as source-of-truth.
- The `inFlow_SalesOrder (16).csv` snapshot is from **2026-04-09** (oldest). The reconcile-inflow-so script expects `(23).csv` per its docstring — that file is not in workspace currently. **Risk: any SO reconcile run today will use 20-day-stale data unless Nate exports a fresh `(23).csv`.**
- `Abel_InFlow_Price_Import.csv` is per-customer pricing scheme — NOT in any reconcile script. This is custom-builder-pricing and should map to `BuilderPricing` table.

---

## 2. Reconcile-script inventory

| Script | Source CSV | Aegis tables touched | Mode | Production-ready? |
|---|---|---|---|---|
| `verify-inflow-liveness.mjs` | (live API ping) | read-only | always read | YES — should be run weekly as a heartbeat |
| `reconcile-inflow-products-stock.mjs` | ProductDetails (13), ProductImages (1), StockLevels (13/14), Door Inventory xlsx | Product, InventoryItem, ProductGroup, ProductImage, InboxItem | DRY-RUN default, `--commit` to write | YES — guardrails in place (null-fill only, no overwrite of non-null catalog data, no PO/Order touching) |
| `reconcile-inflow-po.mjs` | PurchaseOrder (13) | PurchaseOrder, PurchaseOrderItem, Vendor (auto-create) | DRY-RUN default | YES — idempotent, status-mapping logic correct |
| `reconcile-inflow-so.mjs` | SalesOrder (23) — **MISSING** in current workspace! Latest is (16) | Order, OrderItem | DRY-RUN default | YES BUT NEEDS FRESH EXPORT — defaults to a file path that doesn't exist; will fail without `--file` override |
| `reconcile-inflow-customer-bom-ops.mjs` | Customer (5), BOM (8), Operations (4) | Builder (null-fill), BomEntry (upsert), ManufacturingStep (new raw-SQL table), Product.laborCost | DRY-RUN default | YES — strong scope guardrails |

**Expected drift on a fresh dry-run today (based on prior run reports):**

- `verify-inflow-liveness`: Should report InFlow API reachable, last cron success ≤ 15 min ago, ~3,386 InFlow products vs ~3,472 Aegis products (delta ≈ 86, mostly Aegis-side legacy).
- `reconcile-inflow-products-stock`: ~50–100 InFlow-only SKUs to insert (new this week), ~200–400 null-fills on cost/basePrice (per INFLOW-COST-GAP-ANALYSIS: 560 zero-cost SKUs of which 58 backfillable from VendorPrice), ~3,035 InventoryItem upserts.
- `reconcile-inflow-po`: From SCAN-A2 F4 — 158 / 3,827 POs have stale total ($196K abs drift). Many will get status drift updates (Quote/Started → DRAFT/PARTIALLY_RECEIVED).
- `reconcile-inflow-so`: From SCAN-A2 F1 — 4,180 / 4,574 Orders have drift. Status updates likely to be in 2-digit hundreds; line-count diffs are flagged but not rewritten (script intentionally avoids cascading churn).
- `reconcile-inflow-customer-bom-ops`: BOM has 8,201 rows vs Aegis BomEntry pre-count (likely hundreds of upserts; some unknown SKUs flagged); customer null-fills mostly contact/phone/address; Operations creates ~1,830 ManufacturingStep rows from scratch.

---

## 3. Per-table accuracy verdict

Scoring rubric: **TRUSTED** = matches InFlow within tolerance, recent sync, healthy cron. **NEEDS_RECONCILE** = drift > 1% but reconcile script exists and is safe. **KNOWN_BAD** = systemic data-quality flaw documented in prior audit, not yet remediated. **NOT_READY** = empty / dead / blocked.

| Aegis Table | Verdict | Drift vs InFlow | Notes |
|---|---|---|---|
| **Product** | NEEDS_RECONCILE | 86 SKUs Aegis-only, 50-100 InFlow-only, 560 cost=0 (16%) | Cron healthy. Run `reconcile-inflow-products-stock --commit` after fresh export. (INFLOW-COST-GAP-ANALYSIS) |
| **InventoryItem** | TRUSTED (with caveat) | onHand sync continuously every 15 min | Last cron success 04-27 15:30. The reconcile script is the safety net for full snapshots; the cron handles deltas. **Caveat:** `committed` field is allocation-derived and tied to F6 from SCAN-A2 (639 negative-qty OrderItems poison committed counts) |
| **BomEntry** | NEEDS_RECONCILE | InFlow has 8,201 BOM rows; Aegis pre-count unknown but `unknownSkus` set will be non-empty | Run `reconcile-inflow-customer-bom-ops --commit`. Strong guardrails. |
| **PurchaseOrder** | KNOWN_BAD | 158/3,827 with stale `total` ($196K abs drift). Boise AP shows $324K observed vs $88K baseline (268% gap = CRITICAL flag from FINANCIAL-RECON) | **DO NOT INGEST INTO BRAIN** until F4 (SCAN-A2) recompute lands. Reconcile script exists but does not fix the calc-field staleness. |
| **PurchaseOrderItem** | NEEDS_RECONCILE | 15 PO items with `lineTotal != qty * unitPrice` (per A2) | OK — will be fixed by reconcile-inflow-po script when run. |
| **Order** | KNOWN_BAD | **4,180 / 4,574 (91%) have stale `total` — $1.7M net drift, $2.1M abs drift** | **DO NOT INGEST INTO BRAIN.** Single biggest data-integrity problem in the database. F1 from SCAN-A2 is unfixed. Brain reading $7.7M cached vs $6.0M real revenue will produce wrong findings on every customer-revenue scan. |
| **OrderItem** | KNOWN_BAD | 1,377 / 22,441 (6%) `lineTotal != qty × unitPrice`; 639 negative-qty rows (return/credit lines mis-imported as standard); 490 negative-unitPrice rows | F5/F6 from SCAN-A2. Negative-qty pollutes any allocation/picking logic the Brain might consume. |
| **Invoice** | KNOWN_BAD | 585 / 4,124 (14%) negative-total **all marked PAID** = $67K of credits hidden in revenue. AR open balance $72K vs baseline $267K = 73% gap (CRITICAL). | F3 from SCAN-A2 + AEGIS-FINANCIAL-RECON. Stripe webhook is dead. **Block all Invoice/AR Brain features.** |
| **Payment** | NEEDS_RECONCILE | Last `receivedAt` 2026-03-27 = 31 days stale. 0 CREDIT_CARD ever in 4,602 rows. 26 negative-amount rows (refund/credit). No webhook → only check/ACH/wire is logged. | Stripe path dead per SCAN-A4. Currently working only via manual entry. |
| **Builder** | NEEDS_RECONCILE | 9 builders show positive accountBalance ($36.8K credit-on-file) — needs review | Reconcile script will null-fill contact/address/phone. accountBalance flagged in AEGIS-FINANCIAL-RECON. |
| **Vendor** | TRUSTED | reconcile-inflow-po script auto-creates missing vendors with idempotent ON CONFLICT | Boise Cascade observed AP is $324K vs $88K baseline = 268% gap — that's a Boise-side data issue (PO terms / scope), not a Vendor table problem. |
| **Job** | NEEDS_RECONCILE | 3,394 with `scheduledDate < createdAt`, 2,974 with `completedAt < createdAt` (SCAN-A2 F8/F9) | Historical-import artifact, low business risk. Brain should treat `Job.createdAt` < 2026-04-08 as backfill, not lead-time data. |
| **Staff** | NEEDS_RECONCILE | 11 active duplicate name pairs (Darlene Haag, Jacob Brown, Noah Ridge, etc.) | F10 from SCAN-A2. Brain will double-count assignments. Needs Nate to pick canonical email per pair. |
| **AuditLog** | KNOWN_BAD | **0 rows for Invoice / Order / PurchaseOrder / Payment lifetime** | F2 from SCAN-A2. Brain has no provenance signal for state changes. Even if Brain ingest works, "who changed this and when?" is unanswerable. |
| **SyncLog** | TRUSTED | Last 8 INFLOW rows all SUCCESS, recordsFailed=0. Continuous activity. | Use this as the "InFlow is alive" canary for Brain dashboards. |
| **CronRun** | TRUSTED | Last `inflow-sync` at 04-27 15:30. 321 / 379 SUCCESS over 7d (85%). | Same canary — Brain can subscribe to this for cron-failure alerting. |
| **NucHeartbeat** | NOT_READY | 0 rows ever | Hardware not deployed. Brain ingest cron has been 401-ing for 8+ hours per SCAN-A8 — fix `BRAIN_API_KEY` rotation on Vercel before turning on Brain. |
| **HyphenOrder / HyphenDocument** | NOT_READY | Hyphen integration broken — IntegrationConfig row missing, cron lies about SUCCESS while skipping | SCAN-A4 P0. Don't ingest Hyphen-derived data into Brain until config fixed. |
| **Bpw\*** | NOT_READY | 0 rows. Pulte lost 04-20. Crons stopped 04-21. | SCAN-A4 P0 kill recommendation. Drop these tables before ingest. |

---

## 4. Top 5 Data-Quality Risks for Brain ingest

1. **Order.total ($1.7M net drift, 91% of rows wrong)** — every Brain finding involving revenue, margin, builder lifetime value, or YTD will be wrong. **MUST fix F1 before Brain ingests Order events.**

2. **AuditLog empty for financial entities** — Brain ingests "events" but has no provenance. If Brain finds a billing anomaly, there's no way to trace which staffer / system / timestamp introduced it. Compliance and dispute risk.

3. **Negative-total invoices marked PAID ($67K credits hidden in revenue)** — Brain reading the Invoice table at face value will treat 585 credit memos as paid invoices. Customer-success and AR aging scores will be flat-wrong.

4. **Stale SalesOrder export** — `inFlow_SalesOrder (16).csv` is from 4/9, 20 days old. Reconcile script expects `(23)`. Until Nate exports fresh InFlow SO data, **don't rely on the SO reconcile to ground-truth Brain ingest of Orders.** Today's working set includes orders that may have shipped/cancelled/repaid since that export.

5. **560 zero-cost products (16% of catalog)** — only 58 backfillable from `VendorPrice`. The remaining ~500 will produce zero-margin or negative-margin signals to the Brain. Brain's product-grade scoring will bias toward services / placeholders / Toll Bid Sheet items.

Honorable mentions: 22 products priced below cost (active!) → revenue-leak signal; 11 staff dupes → double-counted assignments; Hyphen + Stripe webhooks fully dead → no real-time inbound signal for Brain.

---

## 5. Recommended pre-Brain cleanup steps (in order)

**Block 1 — Diagnostics (15 min, read-only, run today)**

1. `node scripts/verify-inflow-liveness.mjs` — confirm cron alive + API reachable + Aegis vs InFlow product count delta.
2. Export fresh `inFlow_SalesOrder (23).csv` and `inFlow_PurchaseOrder (14+).csv` from InFlow UI before any reconcile.
3. Run all four reconcile scripts in DRY-RUN mode and capture logs:
   - `node scripts/reconcile-inflow-products-stock.mjs`
   - `node scripts/reconcile-inflow-po.mjs`
   - `node scripts/reconcile-inflow-so.mjs --file <fresh-23.csv>`
   - `node scripts/reconcile-inflow-customer-bom-ops.mjs`
4. Diff the dry-run output against expected drift (per section 2 above). Flag unexpected delta deltas.

**Block 2 — Data-correctness fixes (this week, before Brain wired up)**

5. Land **W1-ORDER-TOTAL** (SCAN-CONSOLIDATED W1) — recompute `Order.total` from items. ONE-SHOT migration + Prisma middleware. **This is the single highest-leverage fix.**
6. Land **W1-AUDIT-PERSIST** — fix `audit()` silent catch in `src/lib/audit.ts` so AuditLog actually persists going forward. Backfill Invoice/Order/PO with a `LEGACY_BACKFILL` audit row.
7. Land **W1-NEGATIVE-INV** — quarantine 585 negative-total invoices into `CreditMemo` model OR add `Invoice.type` discriminator. Do BEFORE Stripe/QB sync turns on.
8. Run `reconcile-inflow-po --commit` to recompute PO totals (158 rows, $196K).
9. Run `reconcile-inflow-products-stock --commit` after fresh ProductDetails export, to backfill ~58 zero-cost SKUs from `VendorPrice` and pull new SKUs.
10. Run `reconcile-inflow-customer-bom-ops --commit` for BOM upserts + Operations import.
11. Run `reconcile-inflow-so --commit --file <fresh-23.csv>` AFTER step 5 (Order.total recompute) — otherwise the SO reconcile will write status updates against rows whose totals are still wrong.

**Block 3 — Brain wiring (after Block 2, in this order)**

12. Fix `BRAIN_API_KEY` mismatch (SCAN-A8 P0) so `aegis-brain-sync` cron stops 401-ing.
13. Decide which tables to ingest. Recommended initial set:
    - **YES**: Product, InventoryItem, BomEntry, Vendor, Builder, Staff (after dupe cleanup), Job (with `createdAt > 2026-04-08` filter), SyncLog, CronRun, ManufacturingStep
    - **HOLD**: Order, OrderItem, Invoice, Payment, PurchaseOrder, PurchaseOrderItem until Block 2 lands
    - **NEVER**: Bpw\*, Hyphen\* (until config fixed)
14. Add `BrainSync` model (SCAN-A8 P2) tracking `lastSuccessfulIngestAt` per entity-type — Brain freshness needs to be visible on dashboard.
15. Run `scripts/workspace-to-brain-ingest.ts` once for memory/brain context (one-shot manual). No DB record of it ever running per SCAN-A8 — schedule weekly.

**Block 4 — Anomalies that Brain itself should help surface**

16. The **InFlow `Cost=0` quality issue** (560 zero-cost SKUs, 100% mirror of upstream InFlow data). Brain should run a recurring scan over InFlow exports + Boise PO line history to detect new zero-cost SKUs and either auto-source from `VendorPrice` or open an InboxItem for manual entry.
17. **Pulte zombie jobs** — 246 jobs marked COMPLETE but still appearing on dashboards (per SCAN-A2). Brain can be the system that catches these going forward.

---

## 6. Anomalies surfaced

- **Workspace has TWO InFlow naming conventions:** `InFlow_Upload_*.csv` (4/12, sparse upload templates) at workspace root vs `inFlow_*.csv` (full exports) under root + `Downlods/Downloads/`. Easy to grab the wrong one. Reconcile scripts hardcode the `Downlods/Downloads/` path. Recommend: standardize on a single export folder, gitignore exports older than 30 days.
- **`reconcile-inflow-so.mjs` references `inFlow_SalesOrder (23).csv` which doesn't exist in the current workspace.** Latest is `(16)` from 4/9, then `(17)` from 4/9 (1 row diff). Either rename `(17)` to `(23)` or, more correctly, export a fresh one — there are **20 days of changes** between today and `(16)`.
- **`Abel_InFlow_Price_Import.csv`** is per-builder pricing — not currently in any reconcile script. Should map to `BuilderPricing` table (which exists per Product schema FK). Risk: that pricing matrix may be stale on Aegis side.
- **`InFlow Reports/Purchase order details.csv`** referenced in INFLOW-COST-GAP-ANALYSIS for Tier 3 backfill is not used by any reconcile script.
- **Workspace hardcoded paths use `C:/Users/natha/Downloads/`** instead of OneDrive workspace root — only dev-machine-portable. Will break in CI / Cowork sandbox.
- **PaymentTerm enum in reconcile-inflow-customer-bom-ops** maps `Net 15` and below → NET_15, anything else → NET_30. Builder.paymentTerm column will get auto-tightened from NET_30 default to NET_15 for any customer with `Net 15` in InFlow. Worth a Nate spot-check before --commit.

---

## 7. Ready-to-Brain-Ingest score: **42 / 100**

Breakdown:

| Component | Score | Weight |
|---|---:|---:|
| Catalog accuracy (Product / InventoryItem) | 75 | 20% |
| BOM / Operations | 80 | 10% |
| Order accuracy (totals, line items, statuses) | 15 | 25% — **F1 dominates** |
| Invoice / AR accuracy | 25 | 15% — F3 + AR gap |
| PurchaseOrder / AP accuracy | 50 | 10% — F4 |
| Audit trail | 5 | 10% — F2 |
| Cron + integration health | 70 | 5% — InFlow good, Hyphen/Stripe/Brain dead |
| Master data hygiene (Builder, Vendor, Staff) | 65 | 5% |

**= 0.20×75 + 0.10×80 + 0.25×15 + 0.15×25 + 0.10×50 + 0.10×5 + 0.05×70 + 0.05×65 = 41.75 ≈ 42**

To get to 80+, ship W1 wave (F1, F2, F3, F4, F6) and run the four reconcile scripts in --commit mode after fresh exports.

---

## Files cited

- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/scripts/verify-inflow-liveness.mjs`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/scripts/reconcile-inflow-products-stock.mjs`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/scripts/reconcile-inflow-po.mjs`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/scripts/reconcile-inflow-so.mjs`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/scripts/reconcile-inflow-customer-bom-ops.mjs`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/docs/SCAN-A2-DATA-INTEGRITY-DEEP.md`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/docs/SCAN-A4-INTEGRATION-FRESHNESS.md`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/docs/SCAN-A8-NUC-BRAIN-WIRING.md`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/docs/SCAN-CONSOLIDATED.md`
- `C:/Users/natha/OneDrive/Abel Lumber/AEGIS-FINANCIAL-RECON.md`
- `C:/Users/natha/OneDrive/Abel Lumber/INFLOW-COST-GAP-ANALYSIS.md`
- `C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/prisma/schema.prisma` (lines 563, 688, 761, 1693, 1808, 1858, 2410, 3102 for the relevant models)
