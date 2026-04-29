# AUDIT B-5 — Active Projects: File-System vs. Platform Coverage

**Audit date:** 2026-04-28 (launch Monday)
**Auditor:** Aegis platform team
**Scope:** Workstreams + deliverables at `C:/Users/natha/OneDrive/Abel Lumber/` vs. tracking surface in `abel-builder-platform/`
**Verdict:** **None of the strategic workstreams are tracked on the platform.** Every active workstream lives **only on the file system + memory MD files + TASKS.md**. Aegis has no Initiative / Workstream / Strategy model, no decision-records surface, and no document upload that links workspace deliverables to platform records.

---

## Headline gap

The Aegis schema has 195+ models. **Zero are scoped to strategic workstreams.** Specifically:

- `Project` (line 335 of `prisma/schema.prisma`) is a **construction job** keyed by `builderId` + `jobAddress` + `planName` + `sqFootage`. Cannot represent "Hancock Whitney line renewal" or "Boise Cascade negotiation."
- `DecisionNote` (line 1170) is **scoped to a `Job`** via `jobId String` (required, not nullable). Cannot record a decision about a vendor negotiation, lender pitch, or product strategy.
- `Activity` (line 1215) is polymorphic across `builderId`/`communityId`/`jobId` only — no workstream / vendor / lender axis.
- `Task` (line 1265) is polymorphic across `jobId`/`builderId`/`communityId` only — no workstream link.
- `DocumentVault` (line 4347) supports 14 entity links (builder, order, job, quote, invoice, deal, vendor, PO, door) but has **no workstream/initiative/decision link**, and there is no UI for uploading the workspace `.pptx`/`.xlsx`/`.docx` deliverables. Categories include `CONTRACT`/`REPORT`/`CORRESPONDENCE` but the surface is read-only via `/ops/documents/vault`.

The closest thing on the platform that resembles a "what's the team working on" surface is `/ops/projects` — which is a **PM command-center for construction jobs** (PM rosters, alerts, material shortages). Not strategic projects.

There is no `/ops/strategy`, `/ops/initiatives`, `/ops/decisions`, or `/ops/board`.

---

## Per-project status matrix

| Priority | Workstream | File-system reality | Platform reality | Gap |
|---|---|---|---|---|
| **P0** | **Hancock Whitney line renewal** | `Hancock Whitney Pitch - April 2026/` (5 PPTX/XLSX), `AMP_Line_Renewal_Bank_Pitch.pptx`, `Abel_Bank_Review_April_2026.pptx`, `Abel_Builder_Platform_Bank_Presentation.pptx`, `AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx`, `24-Month Financial Outlook for Abel Doors & Trim.docx`. Memory file `memory/projects/hancock-whitney-line-renewal.md`. TASKS.md item: "confirm meeting date; identify HW review contact(s); prep follow-ups." | **Nothing.** No `Vendor` row for HW (it's a bank, not a supplier). No `Deal`. No `Activity` (Activity requires builder/community/job). Pitch deck not in DocumentVault. | **No tracking surface for lender relationships.** No deck attached. No meeting date. No owner. No follow-up tasks linked. |
| **P0** | **MG Financial litigation** | `MG Financial Evidence for Counsel/` (8 sub-folders), `Abel Lumber v MG Financial - Evidence Summary for Counsel.docx`. Memory file `memory/projects/mg-financial-litigation.md` shows **SETTLED 2026-04-21 at $5,000** — paperwork pending. | **Nothing.** No legal/litigation model. No counterparty. No settlement record. Privileged content explicitly flagged "Claude must not surface externally" — but no platform-side privilege/access-controls exist either. | **No legal-matter tracking, no privileged-doc partition, no settlement-status field anywhere on the platform.** Even the closeout (paperwork from Mark Simon) has no surface. |
| **P0** | **AMP / Boise Cascade negotiation** | 11 root-level `AMP_*` files: spend outlook, EBITDA package, won-work pipeline, material-planning workbook, PO drafts. TASKS.md has 13 active line items (PO releases, account reconciliation memo, 4/28 Heim BBQ in-person at 10:30 CT, supplier-diversification plan). | **Partial.** `Vendor` model exists; Boise Cascade likely has a vendor row + scorecards (`VendorScorecard`, `VendorPerformance`, `VendorPerformanceLog`). `PurchaseOrder` rows exist for the in-flight POs (3499, 3667, 3724, 3743, 3995). **But no negotiation/strategic-relationship layer** — no "credit hold status," "monthly spend outlook," "diversification target," "in-person meeting scheduled 4/28" anywhere on the vendor page. PO releases live in TASKS.md, not as workflow. | **No vendor-relationship workstream layer above PurchaseOrder.** EBITDA & spend outlook sit only as XLSX files. No 4/28 meeting record on Calendar→platform. |
| **P0** | **Brookfield value engineering / Rev 4** | `Brookfield/Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx`, `Brookfield_Value_Engineering_Proposal_April_2026.xlsx`, `Brookfield_Account_Audit_April_2026.xlsx`, `Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx`. TASKS.md: "Amanda Barham accepted Rev 4 4/21 22:40 UTC, awaiting corporate sign-off." | **Builder row likely exists** (Brookfield/BWP). `BwpFieldPO`, `BwpInvoice`, `BwpCheck`, `BwpBackcharge`, `BwpJobDetail` models present — solid integration data. **But:** Rev 4 plan-breakdown XLSX not in DocumentVault, "awaiting corporate sign-off" status not on the builder page, Hyphen 0/80 link rate (per CLAUDE.md) is not surfaced as a data-quality issue. | **Builder-pricing strategy artifacts disconnected from Builder/Community records.** Pricing-rev history only exists as XLSX filenames in OneDrive. |
| **P0** | **Pulte Growth Strategy → LOSS** | Multiple `Abel_Lumber_Pulte_*` files: proposal letter, tier pricing, BWP exports, contacts CSV. **Account LOST 2026-04-20.** `Pulte_PO_Impact_For_Thomas.xlsx` quantifies 21 POs / ~$32.5K exposure. Post-mortem planned by 4/30 in TASKS.md. | **Builder row exists** (PulteGroup/Centex/Del Webb). Active POs are live in `PurchaseOrder` table. No "ACCOUNT_LOST" status on Builder model. No post-mortem field. The 21 POs in cancel/reduce flow as TASKS.md actions, not platform workflow. | **No "lost / churned" lifecycle on the Builder model.** No revenue-backfill modeling. No post-mortem capture. The single biggest revenue event of 2026 is invisible to the platform. |
| **P1** | **Catalog cleanup / pricing corrections** | `Abel_Catalog_CLEAN.xlsx`, `Abel_Catalog_Cleanup_Phase1_Review.xlsx`, `Abel_Pricing_Corrections.xlsx`, `Abel_Product_Catalog_LIVE.xlsx`, `CATALOG_COMPLETE.md`, `Abel_OS_Catalog_Rebuild_Plan.docx`. | **Live data on platform.** `Product`, `BuilderPricing`, `PricingRule`, `PricingTier`, `PricingEvent`, `ContractPricingTier`, `DynamicPriceRule`, `SubcontractorPricing`, `CategoryMarginDefault` — pricing is the most-modeled area in the schema. | **Workstream-level "what's the catalog cleanup project doing" is missing.** Discrete pricing-correction batches are not tracked as a project; no dashboard for "how many SKUs cleaned this week." Plan doc (`Abel_OS_Catalog_Rebuild_Plan.docx`) not on platform. |
| **P1** | **Inventory count April 2026** | `Abel_Inventory_Count_Sheet_April2026.xlsx` (+ duplicate), `Abel_Inventory_Count_Analysis_April2026.docx`. | **Strong platform support.** `InventoryItem`, `InventoryAllocation`, `WarehouseBay`, `BayMovement`, `StockTransfer`, `/ops/warehouse/cycle-count`, `cycle-count-schedule` cron all present. | **April-2026 count event itself is not a tracked workstream object.** XLSX results are not in DocumentVault. No reconciliation summary surface. |
| **P1** | **Delivery outsourcing eval** | `Delivery Outsourcing/`: `Abel Lumber - Delivery RFQ.docx`, `Delivery Outsourcing Memo - Abel Lumber.docx`. Memory `delivery-partners.md` shows **Curri integration KILLED 2026-04-22** (decision logged). | **Decision execution shipped** (env vars removed, `/ops/delivery/curri` static, route returns 501). But the **decision record itself** lives only in the memory MD file. No platform Decision-Record entity. RFQ doc not in vault. | **Decision-records have no home on the platform.** Memory MDs and code commits are the only audit trail for "why we killed Curri." |
| **P2** | **Alibaba / non-China sourcing** | `Abel_Alibaba_Sourcing_Analysis.xlsx`, `Abel_Supplier_Research_Non-China.xlsx`. TASKS.md: "rising urgency given Pulte revenue loss — lower BC concentration." | **Nothing.** No supplier-research / prospect-vendor model. `Supplier` model exists but it's for current vendors, not pipeline. | **No vendor-pipeline / supplier-evaluation tracking** parallel to the builder/customer pipeline (which `Deal`/`Prospect` does cover). |
| **P2** | **memory/projects/ — meta** | 7 MD files: hancock, mg-financial, delivery-partners, hyphen-payment-sign-fix, p-card-icp-reference, custom-builder-outreach-playbook, quickbooks-decision. **All authoritative project records live here, not on platform.** | None of these are surfaced on the platform. They're filesystem-only knowledge. | **The actual project ledger is in `memory/projects/`, not the platform.** No sync. No discoverability for staff who don't open Claude. |

---

## Cross-cutting findings

### 1. Decision records have no platform home
`DecisionNote` exists but requires `jobId`. The strategic decisions (kill Curri, settle MG at $5K, reframe HW pitch around Brookfield, P-Card as wedge for custom builders) are **not job-scoped** and have no platform anchor. They live in:
- `memory/projects/*.md` (7 files)
- TASKS.md "Decisions locked" sections
- Email threads

If Nate is hit by a bus, there's no platform-side audit trail for "why did we settle MG at $5K." Compliance + continuity risk.

### 2. DocumentVault is built but unused for strategic docs
The schema supports 14 entity links and 15 categories. The page at `/ops/documents/vault/page.tsx` exists. But the workspace's strategic deliverables — `AMP_Line_Renewal_Bank_Pitch.pptx`, `Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx`, `MG Financial Evidence for Counsel/`, `Pulte_PO_Impact_For_Thomas.xlsx` — are **not uploaded.** DocumentVault appears to be wired for transactional docs (quotes, invoices, blueprints) but the upload UX for strategic docs (no entity link, just a workstream tag) is missing.

### 3. The platform tracks operations; OneDrive tracks strategy
There's a clean operating split, accidental but consistent:
- **Aegis** = transactional / operational (POs, jobs, invoices, deliveries, MRP, AR/AP)
- **OneDrive + memory/** = strategic / relational (lender pitch, vendor negotiation, account post-mortems, ICP playbooks)

That split worked when the team was 5 people in one office. With 14+ employees + post-buyout transition + DFW expansion + multi-tenant phase 1 starting Monday, the strategic layer needs to graduate to a tracked surface.

### 4. Multi-tenant Phase 1 is itself an untracked project
`abel-builder-platform/CLAUDE.md` is explicit about Phase 1 (multi-tenant rebrand to Aegis Builder/Supplier/Platform/Capital, `phase-1` branch, gates, NEEDS NATE checkpoints). But Phase 1 itself is not modeled in the platform — its tasks live in `Phase_1_Task_Queue.md` (workspace root), not as platform records. The platform does not eat its own dog food.

### 5. Tasks.md is the de facto project tracker
TASKS.md (240 lines, P0/P1/P2 buckets, owner + deadline format) is more complete than anything on the platform. It's parsed daily by the memory sync. **It is the system of record for "what's the team doing,"** with 100+ active items spanning every workstream above.

### 6. Memory files are the de facto decision log
`memory/projects/*.md` files have full decision provenance with dates and source IDs (Gmail message IDs). **They are the system of record for "why we did what we did."** Not on the platform.

---

## Recommended platform features (ranked, P0/P1/P2)

### P0 — Build before/around launch (high leverage, small surface)

1. **`Initiative` model + `/ops/initiatives` dashboard** — generic strategic-project entity (not job-scoped). Fields: title, type (LENDER / VENDOR_NEGOTIATION / LITIGATION / ACCOUNT_PURSUIT / SOURCING / INTERNAL_BUILD / OTHER), status, owner (Staff), due date, priority, summary, counterparty (free-text), files (DocumentVault link). Polymorphic Activity/Task/DecisionNote attachment via `initiativeId`. **One page replaces the strategic half of TASKS.md and consolidates the 7 memory MDs.**

2. **DocumentVault upload UI for workstream docs** — the table supports `entityType=INITIATIVE` already (it's a generic string). Add an upload form on the Initiative detail page that drops files into DocumentVault with the category (`CONTRACT`, `REPORT`, `CORRESPONDENCE`) + initiative link. **Unblocks: HW pitch deck, Brookfield Rev 4 XLSX, MG evidence summary, Pulte impact analysis.**

3. **Generalize `DecisionNote`** — make `jobId` nullable, add `entityType`/`entityId` polymorphic pair (mirroring DocumentVault). Now decisions can be logged against an Initiative, Vendor, Builder, or Job. **Unblocks: Curri-kill decision, MG settlement decision, Pulte post-mortem.**

### P1 — Build month one of multi-tenant phase

4. **Builder lifecycle states** — add `lifecycleState` enum to `Builder`: `PROSPECT / ACTIVE / AT_RISK / LOST / CHURNED`. Add `lostAt` / `lostReason` fields. Surface on builder page + `/ops/accounts`. **Unblocks: Pulte LOST visibility, Bloomfield prospect tracking, retention alerts.**

5. **Vendor relationship layer above PO** — `VendorRelationship` model: vendor + status (`STRATEGIC / PRIMARY / SECONDARY / EVALUATING / DEPRECATED`), credit-hold flag, monthly-spend target, in-person-meeting cadence, key-contact thread, attached negotiation files. **Unblocks: Boise Cascade narrative, Alibaba pipeline tracking, supplier-diversification dashboard.**

6. **Tasks.md → Platform sync (one-way, read-only first)** — daily cron parses workspace `TASKS.md` and surfaces it on a `/ops/master-task-list` read-only view, color-coded P0/P1/P2. Cheap. Removes the "team can't see what Nate's tracking" dead spot. Two-way sync later.

### P2 — Strategic (later in Phase 1)

7. **Legal/privileged-doc partition** — DocumentVault category `LEGAL_PRIVILEGED` with role-gated access (Owner/COO only). Sentry & Claude logging exclusions. **Unblocks: MG evidence storage on platform.**

8. **Decision-record + audit timeline per entity** — every Builder, Vendor, Initiative, Project gets a "Decisions" tab showing DecisionNote rows in reverse-chron with author + source link.

9. **Phase 1 build itself becomes an Initiative** — once #1 ships, Phase 1 tasks from `Phase_1_Task_Queue.md` migrate to the platform as the inaugural Initiative. Dogfooding.

---

*File: `abel-builder-platform/docs/AUDIT-B-5-ACTIVE-PROJECTS.md`*
*Sources: `prisma/schema.prisma` (lines 335, 1170, 1215, 1265, 4347), `memory/projects/*.md` (7 files), `TASKS.md` (240 lines), `ABEL-OS-ROADMAP.md`, `CLAUDE.md` workspace + repo, `abel-builder-platform/src/app/ops/{projects,documents/vault}/page.tsx`.*
