# AUDIT B-4 — Vendor Files vs. Platform Coverage

_Generated 2026-04-28. Auditor: vendor-relationship review for Aegis Supplier (live) ahead of Phase 1 launch._

This audit compares disk-resident vendor intel against what the Aegis platform models, exposes, and acts on. Findings are prioritized P0 (blocking), P1 (high-value, near-term), P2 (cleanup / nice-to-have).

---

## TL;DR — top three findings

1. **The platform has Vendor + VendorScorecard + VendorPerformance + PurchaseOrder schema, but no first-class place to store negotiations, agreements/contracts, price books, spend forecasts, or strategic decisions.** All of that lives only on disk (`Boise Cascade Negotiation Package/`, `AMP_*`, `Delivery Outsourcing/`, `Boise_Cascade_Pricing_Review.html`). Nate's biggest, most expensive vendor work is invisible to staff inside the app.
2. **Two parallel vendor models exist (`Vendor` and `Supplier`) and the `/ops/vendors/` UI page actually queries `Supplier`, not `Vendor`.** The 1,186-PO / $2.0M Boise Cascade record lives on `Vendor`; Suppliers are the import-research / overseas table. Confusion vector at launch.
3. **Spend forecasts (AMP) are never reconciled with platform PO data.** AMP_Boise_Cascade_Spend_Outlook_2026 sits in OneDrive only; Aegis has $2.0M Boise actuals through `PurchaseOrder` + `VendorPerformance`, but no actuals-vs-forecast view, no annual-volume tracking against negotiated tiers, and no alert when spend trajectory diverges from the forecast that Hancock Whitney was shown.

---

## What lives on disk

### Memory / vendor files
- `memory/vendors/boise-cascade.md` — **rich, current, well-maintained.** Includes 11 BC contacts (Bill Washerlesky, Oliver Seidel, Dylan Simons, LC Carr, Antonio Bautista, Dan Merciez, Colby Lindsey, etc.), credit-hold pattern monitoring, recent activity log (PO releases 3499 / 3667 / 3743 / 3995, 4/28 Heim BBQ meeting, $45K paid 4/20). **None of this contact roster, activity log, or meeting calendar lives in the Aegis platform.**
- No memory file for **DW Distribution** ($968K, 542 POs — second largest vendor by spend), Masonite, JELD-WEN, Therma-Tru, Emtek, Kwikset, Schlage, LP, Metrie, or Weyerhaeuser. Memory directory has only `boise-cascade.md`.

### Boise Cascade Negotiation Package (12 files)
`01_Executive_Summary.docx`, `02_SKU_Pricing_Analysis.xlsx` (+ v2), `03_Market_Research_Brief.docx`, `04_Meeting_Prep_Talking_Points.docx`, `05_Data_Quality_Audit.pdf`, `06_Interactive_Pricing_Dashboard.html`, `07_Credit_Line_Increase_Justification.docx`, `08_Pipeline_Snapshot_for_Antonio_LC.html` + `.pdf`, `Boise_Cascade_Invoices_Due_04-20-2026.xlsx`, `Boise_Statement_vs_InFlow_Receipt_Audit.xlsx` + v2.

Headline numbers from `Boise_Cascade_Pricing_Review.html` (prepared 2026-04-09):
- $1.88M analyzed across 841 SKUs
- **$92,392 documented overpayment** across 221 SKUs (avg variance 20.7% per SKU)
- **7 SKUs sold below cost** (worst -96.6% margin)
- **12 assembled doors with component cost > sale price**
- Pricing proposal: 10–15% reductions on top 50 SKUs, market-anchored

**Platform exposure: zero.** None of this dashboard, target prices, or "below-cost" SKU list is queryable in Aegis. The same data should drive auto-PO blocking, margin alerts, and the Boise scorecard, but doesn't.

### AMP files (workspace root, 13 files)
`AMP_Boise_Cascade_Spend_Outlook_2026.xlsx` + `.pdf` (78 KB), `AMP_High_Level_Summary_Report_2026-02-25.pdf`, `AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx`, `AMP_Line_Renewal_Bank_Pitch.pptx`, `AMP_Material_Planning_Abel_and_Company_2026-02-25.xlsx`, `AMP_PO_Drafts_All_Vendors_2026-02-25.pdf`, `AMP_PO_Drafts_By_Vendor_2026-02-25.zip`, `AMP_Won_Work_Pipeline_CFO_Visual_Summary.pdf`, `AMP_Won_Work_and_Pipeline_Projection_2026.xlsx`, `AMP – Pre Bid Walkthrough Checklist.docx`.

The AMP PO drafts file is the canonical 2026-02-25 snapshot of staff-prepared POs by vendor — these were never imported to Aegis.

### Sourcing / alternatives
- `Abel_Alibaba_Sourcing_Analysis.xlsx`
- `Abel_Supplier_Research_Non-China.xlsx` (8 PROSPECT-NC-* rows already loaded as Vendors per `AEGIS-VENDOR-AUDIT.md`)
- `Abel_Supplier_Outreach_Emails.docx`
- `Supplier_Catalogs/` — full price-book disk store for Boise, Hoelscher, Kval, Kwikset, DFW Door, Wilson Plywood, plus customer pricebooks for Trophy Signature, Toll Brothers, Brookfield, Pulte, plus Material Partners and trim/stair pricebook subfolders.

### Delivery outsourcing (3 files)
- `Delivery Outsourcing/Abel Lumber - Delivery RFQ.docx`
- `Delivery Outsourcing/Delivery Outsourcing Memo - Abel Lumber.docx`
- duplicate `Delivery Outsourcing Memo - Abel Lumber.docx` at workspace root

### Existing audit
`AEGIS-VENDOR-AUDIT.md` (2026-04-23) — vendor-completeness scan over 79 vendors. Outputs:
- 46 COMPLETE / 13 MISSING_CONTACT / 0 MISSING_TERMS / 8 PROSPECT / 12 INACTIVE_NO_POS
- Boise Cascade `BOIS1`: 1,186 POs, $2,005,278.54 spend, 365 VendorProducts, COMPLETE
- DW Distribution `DWDI1`: 542 POs, $968,663.66 spend, 89 VPs, missing address
- Masonite `MASO`: 7 POs, $3,528, 1,052 VPs(!) — likely catalog-only relationship
- METRIE `METR1`: 61 POs, $194,934.89, missing address
- JELD-WEN, LP, Weyerhaeuser, Therma-Tru — **not in roster** (or buried under different codes; only "ThermaTrue TT" with 7 POs / $1,925 appears)
- Emtek, Schlage, Kwikset — `EMTK`/`KWIK1`/`ALLE` are **all flagged INACTIVE_NO_POS or near-zero** despite Nate buying hardware

The vendor-completeness scanner exists (`scripts/vendor-completeness-audit.ts`), is read-only, and emits InboxItems. Good. But it doesn't audit price books, agreements, scorecards, or spend-vs-forecast — only contact/address/terms/PO-history coverage.

---

## What the platform models today

**Live (in `prisma/schema.prisma`):**

| Model | Lines | What it stores |
|---|---|---|
| `Vendor` | 1600–1648 | name/code, contact, payment terms (free-text + `paymentTermDays`), `earlyPayDiscount`, `bulkDiscountThreshold`, `creditLimit` / `creditUsed` / `creditHold`, `riskScore`, `accountNumber`, `inflowVendorId` |
| `VendorProduct` | 1651–1672 | vendor SKU, vendor cost, MOQ, lead time, `preferred` flag |
| `PurchaseOrder` | 1690–1744 | poNumber, status, total, `aiGenerated`, `consolidationGroupId`, `savingsVsLastOrder`, qb sync, inflow sync |
| `PurchaseOrderItem` | 1769–1790 | line items with `receivedQty` / `damagedQty` |
| `VendorPerformance` | 5754–5768 | monthly aggregate: onTimeRate, qualityScore, lateOrders, ytdSpend |
| `VendorPerformanceLog` | 5770–5792 | per-PO log: actual vs expected delivery, fillRate, qualityScore, unitCost |
| `VendorReturn` / `VendorReturnItem` | 5794–5830 | RMA-style return tracking |
| `VendorScorecard` | 5832–5857 | overall + delivery + quality + cost + comm scores, `riskLevel`, `costTrend`, totals |
| `Supplier` / `SupplierPriceUpdate` / `SupplierProduct` | 5539–5626 | **parallel model** — used by `/ops/vendors/page.tsx` (the live UI) via `/api/ops/procurement/suppliers`. Stores quality/reliability ratings, currency, freight cost %, duty rate. Designed for overseas/sourcing research. **Hyphen-separated overlap with `Vendor` is the #1 confusion at launch.** |
| `TrimVendor` | 1676–1688 | install/labor subcontractors only (DFW Door, Texas Innovation rates) |

**Live UI:**
- `src/app/ops/vendors/page.tsx` — actually a **Supplier** management page (queries `/api/ops/procurement/suppliers`)
- `src/app/ops/vendors/[vendorId]/page.tsx` — Vendor detail
- `src/app/ops/vendors/scorecard/page.tsx` + `[vendorId]/scorecard/`
- `src/app/api/ops/vendors/[id]/scorecard/route.ts` + `performance/route.ts`
- Purchasing: `src/app/ops/purchasing/[poId]`, `new`, `optimize`, `smart-po`

**Missing models (zero coverage):**
- No `VendorContact` (multiple contacts per vendor — Boise alone has 11)
- No `VendorAgreement` / `VendorContract` (signed Corporate Guaranty PDF lives on disk, not linked)
- No `VendorPriceBook` / `PriceListVersion` (April 2026 BC price list PDF — disk only)
- No `VendorActivity` / `VendorMessage` / `VendorMeeting` (the 4/28 Heim BBQ meeting, the 4/20 Teams call with LC Carr, the daily PO-release emails are tracked only in Gmail + memory file)
- No `Negotiation` / `Initiative` (the $92K overpayment recovery campaign)
- No `StrategicDecision` / `DecisionRecord` (delivery outsourcing eval, BC concentration risk, Alibaba/non-China sourcing). `DecisionNote` exists but is **scoped to `jobId`** — it's a job-floor note, not a strategic decision record.
- No `SpendForecast` / `AnnualVolumeCommitment` (no place to store AMP outlook → reconcile against actual POs)
- No `RFQ` / `RFQResponse` (Delivery Outsourcing RFQ has no platform home)

---

## P0 — blocking for vendor-aware launch

### P0-1. Pick one vendor model. Fix the `/ops/vendors/` UI confusion.
The page Nate's team will click on Day 1 of the launch (`/ops/vendors`) lists Suppliers, not Vendors. Boise Cascade — the vendor with $2M in POs — is reachable only via direct URL `/ops/vendors/[vendorId]` once you know the ID, or via `VENDOR_PAGE_REFERENCE.md`'s described page (which is not the same code). **Decision and migration needed before launch.** Recommend: keep `Vendor` as canonical, demote `Supplier` to a `vendor.type='OVERSEAS_SOURCING'` flavor, redirect `/ops/vendors` to the credit-aware page documented in `VENDOR_PAGE_REFERENCE.md`.

### P0-2. Boise Cascade pricing-review findings must drive blocking actions.
The 7 below-cost SKUs and 12 below-cost assemblies are documented but **the platform happily lets staff sell them every day**. At launch, this is real money out the door. Need: a `productMargin` flag plus a "below cost" gate on quote creation that surfaces the BC pricing-review SKU list. The data already exists in the dashboard JSON.

### P0-3. Credit-hold workflow needs to mirror the actual BC pattern.
`Vendor.creditHold` is a boolean. Reality is "payment-first, release-after" — POs sit pending Dylan Simons' release after Abel pays. The memory file documents this for 6+ POs across 4/13–4/27. Schema needs: `PurchaseOrder.releaseStatus` (HELD_PENDING_PAYMENT / RELEASED / NOT_HELD), `releasedAt`, `releasedById`, `paymentRequiredBeforeRelease`, plus an inbox alert when a PO sits HELD > 24 hours. Without this, Thursday's 4/30 will-call list relies on Thomas's email memory.

---

## P1 — high-value, near-term

### P1-1. `VendorContact` table.
11 BC contacts in memory file alone. None exposed in app. Should support role tags (CREDIT, SALES, MILLWORK_GM, ESCALATION, REGIONAL_MGR) and a "primary" flag per role.

### P1-2. `VendorAgreement` + `VendorPriceBook` models.
Link signed Corporate Guaranty PDF, BC April 2026 price list, all `Supplier_Catalogs/` PDFs. Versioned: every new price-list PDF triggers a `SupplierPriceUpdate`-style diff vs. the prior version. The infrastructure for `SupplierPriceUpdate` already exists for sourcing — extend it.

### P1-3. AMP spend forecast → actual reconciliation.
Import `AMP_Boise_Cascade_Spend_Outlook_2026.xlsx` into a `VendorSpendForecast` table. Daily cron compares forecast quarter against `PurchaseOrder` actuals grouped by vendor. Alerts: variance > 10%. This is the same number Hancock Whitney was shown in the line-renewal pitch — divergence is a bank-relationship event, not a procurement event.

### P1-4. Strategic-decision records (vendor-scoped).
A `StrategicDecision` model with `entityType` (VENDOR/CUSTOMER/INTERNAL) + `entityId`, status (UNDER_REVIEW / DECIDED / DEFERRED), inputs (linked file URLs), decision summary, decided-by, decided-at. First three rows on Day 1:
- Boise Cascade concentration risk → diversification plan
- Delivery outsourcing eval (Abel Lumber - Delivery RFQ.docx is live)
- Non-China sourcing (`Abel_Supplier_Research_Non-China.xlsx`, 8 PROSPECT vendors already loaded)

### P1-5. Vendor activity timeline + Gmail integration.
The boise-cascade.md memory file is essentially a manual `VendorActivity` feed populated from Gmail (thread IDs cited: `19dbd187ba77b622`, `19dabfe67d7b7f5c`, etc.). Build a `VendorMessage` table fed by the Gmail integration. Tag PO numbers, contact emails. Surface in vendor detail page as a timeline.

### P1-6. Fill memory directory for the next 5 vendors by spend.
DW Distribution ($968K), Texas Innovation ($268K), METRIE ($195K), Western Window Systems ($178K), BlueLinx ($142K). Memory layer is supposed to be the canonical "what is the platform missing" — these don't have files, so there is no list of what's missing.

---

## P2 — cleanup

### P2-1. Vendor cleanup pass — 12 INACTIVE_NO_POS and 8 PROSPECT rows.
Clear the obvious junk (`,",True`, `Vinson Test`, `BRING C/C TO STORE WHEN READY TO PICK UP`, `DFW`, `DW`). Decide on the 8 sourcing-research prospects: convert to `Vendor.type='OVERSEAS_SOURCING'` or purge.

### P2-2. Hardware-vendor data is broken.
Emtek, Schlage, Kwikset all flagged INACTIVE_NO_POS but Abel obviously buys hardware. POs likely sit under DW Distribution (a distributor) or other reseller codes. Tag manufacturer-of-record on `VendorProduct` so Boise-distributed Therma-Tru, DW-distributed Schlage roll up cleanly.

### P2-3. Reconcile `ThermaTrue` (TT) vs. `Therma-Tru` naming.
Casing/spelling drift. `TT` has 7 POs / $1,925; real Therma-Tru spend almost certainly higher and routed through DW.

### P2-4. Workspace duplicates.
`Delivery Outsourcing Memo - Abel Lumber.docx` exists at both `Delivery Outsourcing/` and workspace root. `AMP_Boise_Cascade_Spend_Outlook_2026 (1).pdf` and several other ` (1)` duplicates. Clean before they confuse imports.

---

## Per-vendor gap matrix

Legend: ✅ covered · ⚠️ partial · ❌ missing · — n/a

| Vendor | Spend (PO $) | Relationship status | Credit terms | Scorecard | Multi-contact | Special agreements | Spend forecast vs PO | Pricing schedule | Open negotiation as actionable | Memory file |
|---|---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Boise Cascade** | $2,005,278 | ⚠️ memory-file rich, schema empty | ⚠️ creditLimit only | ✅ scorecard model exists; populated? unclear | ❌ 11 contacts, 1 in DB | ❌ Corporate Guaranty PDF on disk only | ❌ AMP forecast not imported | ❌ April 2026 price list PDF on disk | ❌ $92K overpayment + 7 below-cost SKUs not in inbox/actions | ✅ |
| **DW Distribution** | $968,664 | ❌ no notes anywhere | ⚠️ schema-default | ⚠️ presumed populated | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Masonite** | $3,528 (1,052 VPs) | ❌ | ❌ no terms | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **JELD-WEN** | not in roster | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Therma-Tru / TT** | $1,925 | ❌ likely under DW | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Emtek** | $0 (INACTIVE_NO_POS) | ❌ misclassified | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Kwikset** | $0 (KWIK1) | ❌ misclassified | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Schlage / Allegion** | $0 (INACTIVE_NO_POS) | ❌ misclassified | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **LP** | not in roster | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **METRIE** | $194,935 | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Weyerhaeuser** | not in roster | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Delivery outsourcing — is this a Decision record on the platform?

**No.** `Delivery Outsourcing/Abel Lumber - Delivery RFQ.docx` and `Delivery Outsourcing Memo - Abel Lumber.docx` exist on disk. There is no platform model for an RFQ, no model for a strategic decision-in-progress, and no inbox surface for staff to see "we're evaluating outsourcing delivery — your input is requested." The closest schema candidate (`DecisionNote`) is hard-keyed to `jobId` and is for production-floor notes, not for company-level decisions.

This is the cleanest example of why P1-4 (StrategicDecision model) matters: a real, dollarized, in-flight decision with stakeholder input, vendor RFQs, and consequences for `Delivery` / driver staffing — and zero platform footprint.

---

## Reconciliation summary

| Question | Answer |
|---|---|
| Does Vendor capture **relationship status**? | ⚠️ `notes` free-text + `active` boolean + `riskScore`. No status enum (PROSPECT/ACTIVE/AT_RISK/PHASING_OUT). |
| Does it capture **credit terms**? | ✅ `paymentTerms`, `paymentTermDays`, `earlyPayDiscount`, `earlyPayDays`, `creditLimit`, `creditUsed`, `creditHold`, `bulkDiscountThreshold`, `bulkDiscountPercent`. Strong. |
| Does it capture **scorecard data**? | ✅ Schema yes (`VendorScorecard`, `VendorPerformance`, `VendorPerformanceLog`). Populated: not verified in this audit. |
| Does it capture **contact info**? | ⚠️ One contact per vendor (`contactName/email/phone`). No multi-contact. |
| Does it capture **special agreements**? | ❌ No `VendorAgreement`. No file/PDF link from vendor record. Corporate Guaranty PDF, signed pricing sheets, RFQ responses all live on disk only. |
| Are spend forecasts (AMP) reconciled with PO data? | ❌ AMP files have never been imported. No `VendorSpendForecast` model. |
| Are pricing schedules tracked? | ❌ Only on disk. No `VendorPriceBook` / `PriceListVersion`. `Supplier_Catalogs/` is the file system of record. |
| Are open negotiations tracked as actionable items? | ❌ Boise pricing review (proposal letter date 2026-04-09, $92K target recovery) lives in OneDrive HTML. Not surfaced in inbox, no owner, no due date. |
| Is delivery outsourcing eval a Decision record? | ❌ Disk-only RFQ + memo. No platform model for strategic decisions. |

---

_End of AUDIT-B-4-VENDOR-FILES.md_
