# AUDIT-B-8 — Catalog / Inventory / Pricing Data Gap

**Auditor:** Claude (Opus 4.7) — research agent
**Run:** 2026-04-28 (Monday launch day)
**Scope:** Excel/CSV intel in `C:/Users/natha/OneDrive/Abel Lumber/` vs Aegis Supplier `Product` / `InventoryItem` / `BuilderPricing` tables on prod.
**Mode:** Read-only. No DB writes. No file moves.

---

## TL;DR

The catalog and per-builder pricing have **already been pushed to prod** (3,081 Products, 1,821 BuilderPricing, 618 InventoryItem rows on 2026-04-22 per `AEGIS-DATA-LOADED-MANIFEST.md`). The "Catalog migration deferred" item is **closed** (per `docs/SCAN-CONSOLIDATED.md` S5: tables exist, A7 confirmed schema match). What remains are five real gaps:

1. **750 products still at $0.00** — `Abel_Products_Needing_Pricing.xlsx` was generated 2026-03-23 and never imported. No ETL targets it. **P0** revenue/margin risk.
2. **Pricing-corrections file is verified-only, not applied** — `scripts/verify-pricing-corrections.ts` is read-only. The 71 below-cost SKUs in `Abel_Pricing_Corrections.xlsx` were partially absorbed via `etl-q4q1-rebuild.ts` for Brookfield/Toll only. Pulte (LOST), AGD, Joseph Paul, Stately, JCLI etc. corrections are still pending. **P0** for any account other than Brookfield/Toll.
3. **No ingest UI** — `POST /api/admin/sync-catalog` exists for `Abel_Catalog_CLEAN.xlsx` only, hard-coded path. No upload form, no ingest for inventory counts, pricing-corrections, or per-builder pricing matrices. Updates require shell access. **P1**.
4. **Inventory count is partial** — only 618 `InventoryItem` rows from the April 2026 count, while the source sheet has 3,106 active SKUs and `Phase1_Review` warns 2,672 uncounted items would zero out $112,868 of stated value. ETL refused to run on blank sheet. **P1**.
5. **BuilderPriceTier doesn't exist** — there is no `BuilderPriceTier` model in the schema. All custom pricing is one row per `(builderId, productId)` in `BuilderPricing` (no tiering, no effective dates, no version history). The Pulte-style "Centex/Pulte/Del Webb" tiers in `Abel_Lumber_Pulte_Tiered_Pricing_April2026.xlsx` could not be modeled even if Pulte was still a customer. **P2** (academic now that Pulte is LOST).

---

## Schema reality check (`prisma/schema.prisma`)

| Model | Line | Key fields |
|---|---:|---|
| `Product` | 688 | `sku` (unique), `cost`, `basePrice`, `minMargin` (default 0.25), `productType`, `categoryId`, `supplierId` |
| `BuilderPricing` | 778 | `(builderId, productId)` unique, `customPrice`, `margin`. **No tier, no effectiveAt, no version, no source.** |
| `InventoryItem` | 1794 | `productId` unique, `onHand`, `committed`, `available`, `reorderPoint`, `lastCountedAt`. **No `Product` FK** ("relation not added to keep migration simple"). |
| `ProductCategory` | 5046 | Live, `marginTarget` per category |
| `BomEntry` | 761 | parent/component pairs |
| `UpgradePath` | 796 | from/to product, `costDelta`, `priceDelta` |

**Missing models:** `BuilderPriceTier`, `PriceList`, `PricingCorrection`, `InventoryCount` (events). Pricing changes have no audit trail at the `BuilderPricing` row level.

---

## File-by-file inventory

### Workspace root — Catalog masters

| File | Sheets / rows | Authority | Status in DB | Action |
|---|---|---|---|---|
| `Abel_Catalog_CLEAN.xlsx` | Product Master 2,853 / BOM Explorer 7,417 / Upgrade Matrix 1 / Cat Mapping 120 / DQ Flags 982 | **Source of truth** for product taxonomy | Loaded → 3,081 Products + 2,852 taxonomy updates via `etl-product-catalog.ts` + `etl-catalog-taxonomy.ts` (2026-04-22). BoM via `etl-bom.ts`. | **Keep as source.** Re-import on every change via `POST /api/admin/sync-catalog`. **Upgrade Matrix sheet has 1 row** — populate before relying on `UpgradePath`. |
| `Abel_Catalog_Cleanup_Phase1_Review.xlsx` | 9 sheets, 6,723 review rows | Decision package (rules, dupes, gaps) | Reviewed; rules baked into CLEAN | **Archive** post-launch. |
| `Abel_Products_Needing_Pricing.xlsx` | 754 rows / 750 unpriced SKUs | **Active source-of-truth** for pricing gap | **NOT imported.** No ETL exists. Generated 2026-03-23. 750 products at `basePrice = 0` → 360 in "20 MIN FIRE DOOR", 195 in "1 Lite", 90 in "ADT Exterior", 75 in "ADT Attic", 30 in "ADT Dunnage". | **P0 — write `etl-products-needing-pricing.ts`.** Until then, every quote/order using these SKUs sells at $0 default and triggers margin alarms. |

### Workspace root — Pricing corrections

| File | Sheets / rows | Authority | Status in DB | Action |
|---|---|---|---|---|
| `Abel_Pricing_Corrections.xlsx` | All Corrections 312 / Below-Cost 74 / InFlow Import 251 / Impact-by-Builder 21 | **Source of truth** for 310 pricing fixes spanning 18 builders, including 71 below-cost SKUs (-$11,041 total bleed). Top loss: Brookfield BC004198 at -$922.76/unit. | `scripts/verify-pricing-corrections.ts` is **READ-ONLY**. `etl-q4q1-rebuild.ts` absorbed Brookfield (51 inbox items) and Toll (43) only. Pulte / AGD / Joseph Paul / Stately / JCLI / Fig Tree etc. NOT applied. | **P0 — apply remaining 16 builders.** Pulte rows can be skipped (account LOST 2026-04-20). The 31 Toll Brothers, 11 AGD, 13 Joseph Paul, 9 Stately, 7 JCLI, 6 Fig Tree, 5 Truth, 5 Villa-May, 4 Millcreek, 3 First Texas, etc. should be ingested. |
| `Abel_Account_Pricing_Rebuild_Q4Q1.xlsx` | Brookfield 203 / Pulte 155 / Toll 269 (+ exec summary) | Source of Q4/Q1 rebuild | Loaded via `etl-q4q1-rebuild.ts` for Brookfield (302 BP rows) + Toll (326 BP rows). Pulte sheet skipped per LOST status. | **Keep as historical reference.** Mark done. |
| `Abel_Builder_Pricing_Analysis.xlsx` | Builder Detail 1,806 / Below-Cost Alert 73 / Top Products 101 / Recommendations 28 | Analysis layer | `etl-builder-pricing-analysis.ts` is **analytical only** — wrote 3 InboxItems, no BP rows. | **Keep as input** to pricing meetings. Don't load into BP. |

### Workspace root — Inventory

| File | Sheets / rows | Authority | Status in DB | Action |
|---|---|---|---|---|
| `Abel_Inventory_Count_Sheet_April2026.xlsx` | Inventory Count 3,236 / Stock Items 611 / **New Items 106** / Legend 34 | **BLANK** dual-count sheet (Count 1/Count 2/Final Qty empty). NOT authoritative. | `etl-inventory-count.ts` correctly **REFUSES** to read this. Real data comes from `Abel_Recount_Priority_April2026.xlsx` (referenced in script header but **not present** in workspace root scan). 618 InventoryItem rows + 106 RECOUNT_PRIORITY inbox items were loaded. | **P1 — locate or rebuild `Abel_Recount_Priority_April2026.xlsx`.** Without it, ~2,488 SKUs have no current `onHand`. Phase1_Review warns wiping uncounted = -$112,868 stated value. |
| Inventory `New Items Found` tab (106 rows) | Items in warehouse but not in InFlow | Authoritative for new SKU intake | NOT imported | **P2 — when populated, write a `etl-new-inventory-items.ts`** that creates `Product` rows with temp `BC` numbers + `InventoryItem` rows. |

### Builder-specific pricing

| File | Path | Rows | Status | Action |
|---|---|---:|---|---|
| `Bloomfield_Master_Pricing.xlsx` | `Bloomfield Homes/` | 5 plan BoMs (Carolina/Cypress/Hawthorne/Magnolia/Dewberry II) | Loaded via `etl-bloomfield-pricing-v2.ts` — wrote `CommunityFloorPlan.basePackagePrice`, JSON tier breakdown into `takeoffNotes`, plus selected BP rows at 1.37 markup. | **OK.** Source is `Bloomfield_Rev2_Pricing.xlsx`. Keep latest version, archive older `_OLD` and assessment files. |
| `Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx` | `Brookfield/` | Pricing Schedule 279 / Plan Summary 20 / Mantels 8 | Loaded via `import-brookfield-pricing.mjs` + `etl-q4q1-rebuild.ts` → 302 BP rows. Plan Summary tab (20 plans, base prices) **not loaded** — `Plan` table population unconfirmed (`AEGIS-DATA-LOADED-MANIFEST` flagged `42P01`). | **P1 — wire Brookfield Plan Summary into `CommunityFloorPlan` like Bloomfield.** Hyphen `0/80 linked` is the symptom (`docs/AUDIT-DATA-REPORT.md` item #7). |
| `Abel_Lumber_Pulte_Tiered_Pricing_April2026.xlsx` | `Pulte Proposal - April 2026/1. Send to Doug/` | 3 tier sheets (Centex 25%, Pulte std, Del Webb premium) × 67 rows + 45-community summary | **Not loaded.** Pulte LOST 2026-04-20. | **Archive.** Reference only. Schema can't model 3 tiers per builder anyway. |
| Bloomfield per-plan worksheets (Lisa's Bids) | `Bloomfield Homes/Worksheets (Lisas Bids)/` | 21 plan files | Estimator working files | **Keep, not for ingest.** Source for future Plan additions. |
| `Sales Pipeline/Custom Builder Push.../*/Master_Pricing.xlsx` | 50+ files, custom builders | Per-prospect bid templates | **Not loaded.** All prospects, no `Builder` rows yet. | **P2 — load on win** via `seed-builder-pricing-from-excel.mjs` (existing script handles workspace sweep). |
| `GrandHomes_Master_Pricing.xlsx`, `Perry_Homes_Master_Pricing.xlsx`, `FirstTexas_Pricing_Comparison_2024_vs_2026.xlsx` | `Sales Pipeline/` | Per-prospect | **Not loaded.** | **P2** when active. |

### Vendor / supplier catalogs

| File | Use | DB | Action |
|---|---|---|---|
| `Hoelscher_2025_Pricing_Lookup_with_Catalog.xlsx` | Boise/Hoelscher exterior door catalog | Vendor `inflowSku` mapping unconfirmed | **P2** — Boise SKU mapping is a pricing-negotiation dependency. |
| `Boise Cascade Negotiation Package/02_SKU_Pricing_Analysis_v2.xlsx` | Top-15 Boise SKUs | 46 InboxItems via `etl-boise-negotiation.ts`. No pricing writes. | Analytical — keep as source for negotiation. |

---

## Five gaps + recommendations

### Gap 1 — 750 unpriced products (P0)

**Source:** `Abel_Products_Needing_Pricing.xlsx`. Generated 2026-03-23.
**Symptom:** Any quote that hits these SKUs uses `Product.basePrice = 0`. `BuilderPricing` row absent → falls through to base. Margin guards (`minMargin=0.25`) cannot trigger because numerator is 0.
**Recommendation:** Write `scripts/etl-products-needing-pricing.ts` with the same shape as `etl-product-catalog.ts`. Match by SKU. Update only `basePrice` where current value is `0` AND new price is non-zero. Dry-run first. Surface unmatched SKUs as InboxItems with `source='UNPRICED_PRODUCT_2026'`.

### Gap 2 — Pricing corrections not fully applied (P0)

**Source:** `Abel_Pricing_Corrections.xlsx` "All Corrections" sheet (310 rows).
**Symptom:** 71 below-cost SKUs across 18 builders. Brookfield + Toll + Pulte rebuild (310 of these have inbox items but BP write coverage is uneven). Other 14 builders (~95 rows) have NO writes.
**Recommendation:** Extend `etl-q4q1-rebuild.ts` to walk all 18 builders, OR write `scripts/etl-pricing-corrections.ts` keyed off the "All Corrections" sheet. For each row: upsert `BuilderPricing(builderId, productId).customPrice = NEW Builder Price` and `margin = NEW Margin %`. Skip Pulte rows (LOST). Skip rows where current BP `customPrice` already matches. Emit InboxItem per builder for sales review before billing.

### Gap 3 — No ingest UI (P1)

**Symptom:** `POST /api/admin/sync-catalog` is the only HTTP-triggered ingest. It only handles `Abel_Catalog_CLEAN.xlsx` (hard-coded path search). No UI page. All other ETLs require `tsx scripts/etl-*.ts --commit` from a shell.
**Recommendation (Phase 1, post-launch):** Build `POST /api/admin/ingest/{kind}` with `kind ∈ {pricing-corrections, products-needing-pricing, builder-pricing-matrix, inventory-count, bloomfield-pricing, brookfield-pricing}`. Multipart upload of XLSX. Server runs the matching ETL in dry-run + commit modes. Reuse existing scripts. Auth-gate to admin role. Audit-log every run.

### Gap 4 — Inventory count incomplete (P1)

**Symptom:** 618 of ~3,106 active SKUs have current `InventoryItem.onHand`. The remaining ~2,488 SKUs default to `onHand=0` or stale values. `etl-inventory-count.ts` references `Abel_Recount_Priority_April2026.xlsx` which is **not present** at workspace root (only the blank dual-count sheet is).
**Recommendation:** Locate the Recount Priority file (likely under `Operations & Platform/`, `Manufacturing/`, or `Turnaround Package - April 2026/`). If absent, run a second physical count or pull from InFlow `refresh-inventory-from-inflow.mjs` as fallback. Until reconciled, MRP "Smart Reorder" suggestions are unreliable for ~80% of the catalog.

### Gap 5 — BuilderPriceTier doesn't exist (P2 / academic)

**Symptom:** Pulte-style multi-tier (Centex / Pulte / Del Webb) cannot be expressed. One row per `(builder, product)`.
**Recommendation:** Defer. Pulte is gone. Only re-open if a future big builder (Brookfield, Bloomfield, future Pulte replacement) demands tiering. Then add `model BuilderPriceTier { id, builderId, name, isDefault }` and an FK on `BuilderPricing.tierId` (nullable for back-compat). `effectiveAt` and `version` would be cheap additive columns and are worth doing for audit trail regardless.

---

## Files to archive (no longer source-of-truth)

- `Abel_Catalog_Cleanup_Phase1_Review.xlsx` (decisions baked into CLEAN)
- `Bloomfield_Master_Pricing_OLD.xlsx`, `Bloomfield_Pricing_Assessment.xlsx` (superseded by Rev2)
- `Bloomfield_Homes_Pricing.xlsx` and `(1).xlsx` in `Downlods/` (duplicates)
- `Abel_Lumber_Pulte_Tiered_Pricing_April2026.xlsx` (Pulte LOST — keep for litigation/history, mark archived)
- `Trophy_Signature_Pricing_Adjustment_Model.xlsx` v1 (v2 supersedes)

## Files that still hold source-of-truth (do NOT archive)

- `Abel_Catalog_CLEAN.xlsx` — taxonomy, BoM, cost
- `Abel_Pricing_Corrections.xlsx` — until full ingest happens
- `Abel_Products_Needing_Pricing.xlsx` — until $0 SKUs are priced
- `Abel_Account_Pricing_Rebuild_Q4Q1.xlsx` — historical pricing record
- `Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx` — current Brookfield schedule
- `Bloomfield_Rev2_Pricing.xlsx` — current Bloomfield schedule
- `Abel_Recount_Priority_April2026.xlsx` (LOCATE or REGENERATE) — actual count results

---

## Priority summary

| # | Item | P | Owner | Estimate |
|---|---|---|---|---|
| 1 | Apply 750 unpriced products from `Abel_Products_Needing_Pricing.xlsx` | **P0** | Phase 1 / Claude Code | 0.5 day to write ETL + dry-run |
| 2 | Apply remaining 14-builder pricing corrections (~95 rows ex-Pulte) | **P0** | Phase 1 | 0.5 day; gate behind sales review InboxItems |
| 3 | Locate/regenerate `Abel_Recount_Priority_April2026.xlsx`, finish InventoryItem load | **P1** | Nate / Jordyn | physical-count level; ETL ready |
| 4 | Wire Brookfield Plan Summary → `CommunityFloorPlan` (mirror Bloomfield) | **P1** | Phase 1 | 0.5 day |
| 5 | Build `POST /api/admin/ingest/{kind}` UI | **P1** | Phase 1 | 1-2 days |
| 6 | Populate Catalog `Upgrade Matrix` sheet (currently 1 row) | **P2** | Lisa / catalog team | manual |
| 7 | Archive superseded pricing files into `_archive/` | **P2** | Nate | 30 min |
| 8 | Defer `BuilderPriceTier` schema until business need | **P2** | — | not needed for launch |

---

_Read-only audit. Sources: `prisma/schema.prisma` (lines 688/778/1794/5046), `docs/AUDIT-DATA-REPORT.md`, `docs/SCAN-CONSOLIDATED.md`, `AEGIS-DATA-LOADED-MANIFEST.md`, `AEGIS-PRICING-AUDIT.md`, 11 `scripts/etl-*.ts` headers, and direct XLSX inspection of 9 workbook structures._
