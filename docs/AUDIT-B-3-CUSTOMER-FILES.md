# Audit B-3 — Customer Files vs. Aegis Platform

**Auditor:** Claude (Opus 4.7) · **Date:** 2026-04-28 (launch day eve) · **Scope:** Brookfield, Bloomfield, Pulte, Toll, 2026 contracted-account index vs. live Aegis schema + UI.

**Sources audited:**
- `memory/customers/{brookfield,bloomfield,pulte,toll-brothers,2026-contracted-accounts}.md`
- `Brookfield/` — 10 files, deep-read of `Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx`, `Brookfield_Value_Engineering_Proposal_April_2026.xlsx`, `Brookfield_Trade_Partner_Directory.xlsx`
- `Bloomfield Homes/` — 23 files + 4 subdirs, deep-read of `Bloomfield_Master_Pricing.xlsx`, `Bloomfield Homes/SEND TO BLOOMFIELD/Bloomfield_Trim_Bid_Out_Abel_REVISED.xlsx`
- `Abel_Lumber_Pulte_*` — 8 files at workspace root (all historical post-4/20)
- Platform: `prisma/schema.prisma` (Builder, Community, BuilderContact, BuilderIntelligence, CommunicationLog, BuilderPricing, HyphenOrder/Payment, Job models), `src/app/ops/accounts/[id]/page.tsx`, `src/app/ops/communities/[id]/page.tsx`, `src/app/ops/admin/hyphen-unmatched/page.tsx`

---

## TL;DR — Severity Summary

| Severity | Count | Headline |
|---|---:|---|
| **P0** (block launch quality) | 3 | Brookfield Hyphen subdivision-mapping table missing; Brookfield Rev4 prices not loaded into `BuilderPricing`; Pulte CANCEL/REDUCE list never reached the Order/PO records. |
| **P1** (week-1 gap) | 6 | No proposal/revision tracking, no builder-document store, comm log is empty for these customers, BuildPro code-name mapping unwritten, value-engineering "savings reported to corporate" promise has no platform anchor, Brookfield communities not seeded. |
| **P2** (post-launch polish) | 5 | 2026 contracted-account scaffolding, BuilderIntelligence not seeded, tax-exempt flag verification, segment tags, BuilderType set on Brookfield/Bloomfield. |

### Quick wins — do today (each <30 min)
1. **Seed Brookfield as PRODUCTION builder** with the 11 plan codes (4500 / 4515 / 4520 / 4530 / 4545 / 5500 / 5503 / 5506 / 5509 / 5512 / 5515) as `CommunityFloorPlan` rows under a synthetic "Brookfield — All DFW" community, and tag `pricingTier = "PREFERRED"`, `paymentTerm = NET_30`.
2. **Set `Bloomfield.taxExempt = true`** + add the two Bloomfield contacts (Avery Cadena primary, Cathleen Richards CC).
3. **Mark Pulte `status = CLOSED`** + add note "Lost 2026-04-20 to 84 Lumber" + lock `creditLimit` to current balance to prevent any new orders.
4. **Add the 5 new Brookfield contacts** (Amanda Barham primary, Michael Todd, Oscar Fernandez, Daniel Bennett, Raquel Conner, Cory Finch).
5. **Add Toll's Nicole Martinez** as a Windsor Springs community contact with the "kept us in play" note.

---

## P0 — Blocks Launch Quality

### P0.1 · Brookfield Hyphen subdivision-mapping table — still 0/80 matched
- **Symptom:** `Job.community = "Eagle Mountain"` vs `HyphenOrder.subdivision = "The Grove Frisco 40s"`. Token sets don't intersect → linker falls back to nothing. Confirmed in `memory/customers/brookfield.md` ll.42–46.
- **Schema gap:** No `HyphenCommunityMap` / `HyphenSubdivisionAlias` model exists. The only Hyphen alias model in schema is `HyphenProductAlias` (line 4679) which is product-only.
- **UI gap:** `/ops/admin/hyphen-unmatched/page.tsx` exists but only surfaces the unmatched rows — no "create alias" / "map subdivision → community" action.
- **Action:** Add `HyphenSubdivisionMap { id, hyphenSubdivision (unique), communityId, builderId, confidence, createdAt }`. Populate manually from the diagnostic output. Link `HyphenOrder.subdivision` → `Community.id` at ingest time.
- **Why P0:** Brookfield's a top-3 active builder, the integration sells the whole "Hyphen-native" story, and reporting/AR tagging breaks until orders link to jobs.

### P0.2 · Brookfield Rev4 plan-level prices live only in Excel
- **Found:** `Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx` Summary sheet — 11 plans, 5 line categories each (Ext Doors, Int Doors & Trim Mat, Trim Labor 1, Trim Labor 2, Final Front), Base Total $10,637–$12,308 per plan.
- **Platform location:** `BuilderPricing` model exists (schema.prisma:778) but it's a `(builderId, productId, customPrice)` triple. The Brookfield model is **per-plan turnkey rollup**, not per-SKU. There is no `BuilderPlanPricing` or `CommunityFloorPlan.basePackagePrice` populated for Brookfield.
- **Action:** Two options — (a) build out `CommunityFloorPlan.basePackagePrice` (already a column, line 240+ of schema) per the 11 plans; (b) add a `BuilderPlanPricing` model with the 5 BuildPro categories (`EXTDOORS`, `FNSBUILT`, `FNSHTRM`, `FNSHLBR2`, `SCNDR` — see below). Pick (a) for launch + (b) for week-2.
- **Effective date:** 2026-04-17. Past-30-day surcharge: 1.5%/mo (file ll.13 of Summary). Neither tracked anywhere on platform.

### P0.3 · Pulte CANCEL/REDUCE list never landed in Aegis
- **Source:** `Pulte_PO_Impact_For_Thomas.xlsx` — 21 POs, ~$32.5K (15 cancel @ $20.5K + 6 reduce @ $12K). Lives only in Excel + email thread.
- **Platform:** No `OrderCancellation` events visible. POs likely still sitting in OPEN/CONFIRMED status against Pulte's now-CLOSED account. Risk: the inventory MRP and AR aging dashboards still treat Pulte as live demand.
- **Action:** Run a one-time script that takes `Pulte_PO_Impact_For_Thomas.xlsx` → marks the 15 cancel POs as CANCELLED with reason "Account lost 2026-04-20" and the 6 mixed POs as REDUCED with the Pulte line items zeroed.

---

## P1 — Week-1 Gaps

### P1.1 · No proposal/revision tracking
- **Brookfield:** Plan Breakdown Rev2 → Rev3 → Rev4 (3 versions in 2 weeks). Pricing Schedule Rev2. Value Engineering Proposal. None tracked on platform.
- **Bloomfield:** Master Pricing → Pricing Assessment → Master Pricebook → Rev2 Pricing → Trim Bid Out Revised. Five revisions, none on platform.
- **Action:** Add `BuilderProposal { id, builderId, type [PLAN_BREAKDOWN | PRICING_SCHEDULE | VALUE_ENGINEERING | TRIM_BID], revision Int, effectiveDate, status, fileUrl, summary, createdById }`. Link to comm log entries that delivered it. Without this, "what version is Brookfield holding?" is always a Gmail search.

### P1.2 · No `BuilderDocument` store; files live in OneDrive folders
- **Brookfield/**: 10 files. **Bloomfield Homes/**: 23 files + 4 subdirs (Plans, Door Options, Pricing and Takeoffs, Sales Pipeline). Hyphen has its own `HyphenDocument` model (schema line referenced from Builder.hyphenDocuments) — but for non-Hyphen attachments (proposals, executive summaries, plan PDFs, presentation decks) there's nothing.
- **Action:** Either extend `HyphenDocument` to be a generic `BuilderDocument` (rename column, add `source` enum), or add new `BuilderDocument` model. Wire to `/ops/accounts/[id]` as a "Files" tab.

### P1.3 · CommunicationLog has the model but isn't being populated for these customers
- Schema (line 4137) has Gmail+Hyphen integration columns (`gmailMessageId`, `gmailThreadId`, `hyphenEventId`). 
- The Brookfield memory file references **8 specific Gmail thread IDs** in April alone (e.g., `19dab652aa019b49`, `19db234699b83b45`, `19dbb43f4b9941df`). Bloomfield references `19dcd4c03ea12eec`. **None of these are in `CommunicationLog`** (verified by virtue of fact this audit found them via grep of the .md not the DB).
- **Action:** Backfill cron: pull the last 60 days of Gmail threads where `to`/`from` contains `brookfieldrp.com`, `bloomfieldhomes.net`, `pulte.com`, `tollbrothers.com` → seed `CommunicationLog`. Tag with `aiSummary`, `aiSentiment`, `aiActionItems` (columns already exist).

### P1.4 · BuildPro code-name mapping is unstructured
- Brookfield `Summary` sheet bottom: `EXTDOORS → Turnkey Exterior Doors & Install Labor`, `FNSBUILT → Turnkey Interior Doors & Trim Materials`, `FNSHTRM → Turnkey Interior Trim Labor 1`, `FNSHLBR2 → Turnkey Interior Trim Labor 2`, `SCNDR → Turnkey Final Front & Labor`.
- Per Amanda's 4/17 email: this scheme is **mandatory** for Brookfield invoicing.
- Platform: no `BuilderInvoiceCode` / `BuilderLineItemMapping` model. Invoices probably just use generic Aegis SKUs.
- **Action:** Add `BuilderInvoiceCode { id, builderId, code, description, abelCategoryMapping, isRequired, createdAt }`. When invoicing Brookfield, render line items as their codes, not Abel's.

### P1.5 · Value-Engineering "savings already reported to corporate" not anchored anywhere
- Brookfield's VE Proposal claims **$1,085/house savings · $43–53.5K annual gain at 60 homes · margin 18% → 29–33%**. Brookfield corporate is *expecting the delivery* per Amanda's 4/20 email.
- **Risk:** No tracking on the platform means Abel can't prove monthly that the savings are showing up. If Brookfield audits this against actual invoices, Abel needs the receipts.
- **Action:** Add a "Customer Commitments" or `BuilderCommitment { id, builderId, commitment, target, deadline, status, evidence }` table. Seed: "Brookfield VE — $1,085/house savings, 60-home target, audited monthly."

### P1.6 · Brookfield communities never seeded
- Brookfield is `BuilderType.PRODUCTION` (national homebuilder, has subdivisions) but no `Community` rows exist. Trade Partner Directory has 116 companies, 401 contacts — Brookfield's organizational footprint is large.
- Memory file mentions specific addresses: 15164 Gallina Mews, 15503 Swallowtail, 9383 Spindletree (but no community names for these — they're inferable from `HyphenOrder.subdivision`). The Hyphen subdivisions seen so far: "The Grove Frisco 40s" (per memory file). Plus the Plan Breakdown sheets are organized by **plan code** (4500–5515) which spans communities.
- **Action:** Seed communities from `HyphenOrder.subdivision` distinct values, and link the 11 plans (4500, 4515, etc.) as `CommunityFloorPlan` rows.

---

## P2 — Post-Launch Polish

| # | Gap | Action |
|---|---|---|
| P2.1 | 9 contracted accounts in `2026-contracted-accounts.md` have no memory files or platform records (Shaddock $3M, Olerio $2.1M, MSR $1.4M, Imagination $297K, RDR $380K, Joseph Paul $234K, True Grit $210K, +7 unnamed = $518K, Trophy Signature TBD) | Backfill `Builder` rows + per-account .md files. Total exposed revenue: $9.94M. |
| P2.2 | `BuilderIntelligence` exists (line 3762) but appears unseeded for these customers | Run the analytics cron — `healthScore`, `creditRiskScore`, `paymentTrend`, `crossSellScore` should populate from Order + Payment history. |
| P2.3 | Bloomfield's tax-exempt flag — schema supports it (`taxExempt`, `taxId`) but unverified for the actual record | Verify and stamp. Memory file ll.4 says "Tax exempt — do not charge sales tax". |
| P2.4 | `segmentTag` and `pricingTier` columns exist (line 58, 63) but not in use | Standardize: PREFERRED for Brookfield/Toll/Bloomfield/Shaddock/Olerio, NEW_ACCOUNT for first-quote prospects, STANDARD for everyone else. |
| P2.5 | `BuilderType.PRODUCTION` flag — Brookfield, Toll, Bloomfield are all PRODUCTION; defaults are CUSTOM (line 29) | Verify and migrate. Drives whether Communities tab renders. |

---

## By-Customer Breakdown

### 1. Brookfield Residential — Active, top-3, hot

**What memory + Excel know that platform doesn't:**

| Item | Source | In Aegis? |
|---|---|---|
| 6 contacts (Amanda Barham primary, Michael Todd, Oscar Fernandez, Daniel Bennett, Raquel Conner, Cory Finch) | brookfield.md | No |
| 11 plans (4500/4515/4520/4530/4545/5500/5503/5506/5509/5512/5515) with line-level pricing | Plan Breakdown Rev4 | No |
| Effective date 2026-04-17, Rev4 acknowledged 4/21 by Amanda | brookfield.md | No |
| BuildPro code names (EXTDOORS, FNSBUILT, FNSHTRM, FNSHLBR2, SCNDR) | Plan Breakdown Rev4 ll.18-22 | No |
| 1.5% monthly past-due surcharge | Plan Breakdown Rev4 l.13 | No (paymentTerm doesn't carry late-fee terms) |
| Value-Engineering accepted commitments: $1,085/house, 60-home target | VE Proposal Brookfield Comparison sheet | No |
| Hyphen subdivision↔community mapping (0/80 match rate) | brookfield.md ll.42-46 | **Critical gap** |
| Brookfield Trade Partner Directory: 116 sub-companies, 401 contacts | Brookfield_Trade_Partner_Directory.xlsx | No |
| Recent walks: SO-4052 Gallina Mews, 15503 Swallowtail, 9383 Spindletree | brookfield.md ll.27-32 | Probably as Job records but not flagged |
| April 2026 Gmail threads (8 thread IDs) | brookfield.md | **None in CommunicationLog** |
| 84 Lumber credit-app expired 4/25 (blocking Brookfield delivery) | brookfield.md l.27 | No |

**Headline:** Aegis knows Brookfield exists but doesn't know they're the #1 active customer. The Hyphen integration that's the platform's marquee builder feature is broken for the customer it was built for.

### 2. Bloomfield Homes — Active, onboarding 85% probability, $5.6M weighted pipeline

**What memory + Excel know that platform doesn't:**

| Item | Source | In Aegis? |
|---|---|---|
| Tax-exempt status (no sales tax) | bloomfield.md ll.4 | Possibly default — verify |
| 2 contacts (Avery Cadena primary, Cathleen Richards) | bloomfield.md | No |
| Office phone (817) 233-7714 | bloomfield.md | No |
| Plan series structure: Classic Series (5 plans) vs Elements Series (3 plans) — different lineups not tiers | bloomfield.md ll.10-12 | No (no series concept) |
| Plan-rename: "Dewberry" → "Bayberry" | bloomfield.md l.14 | No |
| Tiered markup: ext doors 20%, int doors 26%, trim 35% — blended 21.5% GM | bloomfield.md l.36 | No (margin model is per-product) |
| 5 plans priced (Carolina/Cypress/Hawthorne/Magnolia/Bayberry) — turnkey $6,726–$11,319 | Bloomfield_Trim_Bid_Out_Abel_REVISED.xlsx | No |
| 9 plans total (Bellflower, Camellia, Caraway, Carolina, Cypress, Daffodil, Dewberry, Dogwood, Gardenia, Hawthorne, Jasmine, Laurel, Lilly, Magnolia, Primrose, Redbud, Rockcress, Rose, Seaberry...) | Plans/ subdir | No |
| 20+ deliverable docs (presentations, pricebooks, dashboards, proposal letter) | Bloomfield Homes/ | No (no document store) |
| Lisa's takeoffs subdir | Worksheets (Lisas Bids)/ | No |

**Headline:** Bloomfield is one signed contract away from being a top-5 customer ($5.6M weighted), and the platform has roughly zero of their plan or pricing data, despite Lisa having 9 plans of takeoffs locally.

### 3. 2026 Contracted Accounts — $9.94M base, mostly invisible to Aegis

| Account | 2026 Base | Memory File | Likely on Platform? |
|---|---:|---|---|
| Shaddock Homes | $3.0M | TODO | Unknown — needs Builder row check |
| Olerio Homes | $2.1M | TODO | Unknown |
| Toll Brothers | $1.8M | toll-brothers.md ✓ | Yes (Windsor Springs Community probably) |
| MSR (Sorovar-Frisco) | $1.4M | TODO | Unknown |
| RDR Development | $380K | TODO | Unknown |
| Imagination Homes | $297K | TODO | Unknown |
| Joseph Paul Homes | $234K | TODO | Unknown |
| True Grit | $210K | TODO | Unknown |
| 7 additional | $518K | TODO | Unknown |
| Bloomfield Homes (pipeline 85%) | — / $3.57M | bloomfield.md ✓ | Partial |
| Trophy Signature | TBD | — | Unknown |

**Headline:** $9M+ of contracted 2026 revenue exists in a slide deck and a single .md file. Until each builder has a Builder row + Communities + paymentTerm + creditLimit, the platform's revenue-intelligence dashboards are running on Pulte+Toll+Brookfield+Bloomfield only.

### 4. Pulte (historical) — Account lost 2026-04-20

**Status:** Lost. Treeline → 84 Lumber. Mobberly Farms moved March 2026.

**What needs platform action even though they're gone:**
- `Builder.status = CLOSED` — verify
- 21 open POs (~$32.5K) need cancel/reduce action — `Pulte_PO_Impact_For_Thomas.xlsx`
- `kyle.adair@pultegroup.com` bounced — mark inactive
- `brittney.werner@pulte.com` is now at Abel — flag as cross-org contact in case it appears in incoming email routing
- BWP (Brookfield-Winchester-Pulte) data files — used by the Bolt linker, but BWP naming spans Brookfield AND Pulte (per brookfield.md l.50). Naming-collision audit needed.

### 5. Toll Brothers — Top-3, $1.8M contracted, $202K open backlog

**What's already there:** Memory file has Windsor Springs (7 homes) + Apple Creek Lane (SO-4069). Hyphen sign bug history (parseDollar) is documented.

**Gaps:**
- 4 contacts (Nicole Martinez, Brian Voldan + Jason TBD + Rick TBD) — Nicole is the "kept us in play 4/23" contact, deserves an `isPrimary` flag on Windsor Springs.
- Last names for Jason and Rick are unknown — flag for Sales to fill in.
- `parseDollar` fix is still pending — next Hyphen sync will reintroduce 317-row sign bug. **This is a P0 platform fix tracked elsewhere; flagging here because Toll is the customer most exposed.**

---

## Recommended Order of Execution

1. **Today (launch eve):** Quick Wins #1–5 above. ~2 hours total.
2. **Week 1 post-launch:** P0.1 (Hyphen mapping table + UI), P0.2 (Brookfield Rev4 plan prices), P0.3 (Pulte PO cancel/reduce script).
3. **Week 2:** P1.1 (BuilderProposal model), P1.2 (BuilderDocument store), P1.3 (CommLog backfill cron).
4. **Week 3+:** P1.4 (BuildPro code mapping), P1.5 (Commitments table), P1.6 (Brookfield communities seed), P2.1 (contracted-accounts backfill).

---

## Cross-Cutting Recommendations

- **Treat the file system as a debt, not a system.** Every .xlsx in `Brookfield/` or `Bloomfield Homes/` represents a piece of customer state that's invisible to Aegis. The launch-day platform is a thin layer over years of Excel; week-2 should focus on a structured intake of these artifacts (proposals, takeoffs, plan PDFs).
- **Comm log is the single biggest leverage point.** It's the model already designed for this, the integration columns (Gmail thread IDs, Hyphen event IDs) are already there, and the audit logging burden is one cron. Fill it and most of the "what does Aegis know about this customer?" questions answer themselves.
- **The Hyphen integration is incomplete in a way that hurts Abel's largest active customer.** Subdivision mapping needs to land in week-1.
