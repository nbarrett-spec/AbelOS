# AUDIT-B-1 — Memory Intel vs Platform Reality
**Scope:** memory/ directory
**Date:** 2026-04-28
**Auditor:** Aegis platform team
**Method:** Cross-checked every file in `memory/` (people/, customers/, vendors/, projects/, systems/, brand/, context/, glossary.md) against `prisma/schema.prisma`, `src/app/ops/*`, and known integration code.

---

## P0 — Critical missing platform features

### P0-1. No "Account Lost" status — Pulte loss invisible to platform
- **Memory says:** `customers/pulte.md` documents Pulte was **LOST 2026-04-20** (Doug Gough confirmed Treeline → 84 Lumber; Mobberly Farms moved March 2026; 21 open POs ~$32.5K need cancel/reduce).
- **Platform reality:** `Builder.status` enum is `PENDING | ACTIVE | SUSPENDED | CLOSED` (`schema.prisma:123`). No `LOST`, no `CHURNED`, no `lostDate`/`lostReason`/`competitorWon` fields on Builder. `Deal.lostDate`/`lostReason` exist (line 2145) but only on the deal pipeline, not on a customer that already converted and was later lost.
- **Gap:** Pulte showing as `ACTIVE` in production right now, despite being dead since 4/20. PMs still see Pulte communities in pickers. PO impact list (`Pulte_PO_Impact_For_Thomas.xlsx`) is a one-off spreadsheet — no platform PO-cancel/reduce workflow exists.
- **Add:** `Builder.status` += `LOST`; `Builder.lostDate`/`lostReason`/`lostToCompetitor` fields; bulk-PO-cancel-or-reduce action on the builder detail page; "show inactive" filter default-off across pickers/dashboards.

### P0-2. parseDollar fix not deployed — Hyphen sync still poisoned
- **Memory says:** `projects/hyphen-payment-sign-fix.md` — fix authored, lives at `src/lib/hyphen/parse-dollar.ts`, but the **hyphen-sync cron is paused** because the fix isn't in the live caller. Toll Brothers had to be manually flipped from −$714K to +$719K.
- **Platform reality:** Confirmed `src/lib/hyphen/parse-dollar.ts` exists, plus the test file. The buggy caller (`src/app/api/ops/import-hyphen/route.ts`) is still in the tree.
- **Gap:** Until import-hyphen route uses the new module, the cron stays dark — meaning **Brookfield, Toll, Shaddock payment data is stale**. Memory file says vitest also isn't in `package.json`, so tests can't run in CI.
- **Verify before launch:** that the route imports from `src/lib/hyphen/parse-dollar.ts`, that vitest is installed, and that `15 * * * *` cron is unpaused.

### P0-3. Hyphen community-mapping table doesn't exist — 0/80 linked
- **Memory says:** `customers/brookfield.md` + `systems/abel-os.md` — `Job.community` ("Eagle Mountain") doesn't share vocabulary with `HyphenOrder.subdivision` ("The Grove Frisco 40s"). 0 of 80 HyphenOrders linked. Diagnostic exists at `scripts/diagnose-hyphen-overlap.mjs`.
- **Platform reality:** `HyphenBuilderAlias` model exists (line 4576) keyed `(aliasType, aliasValue) -> builderId`, but **no equivalent for community/subdivision mapping**. The `Community` model has `name` + `code` but no aliases array.
- **Gap:** No table for "Hyphen subdivision X = Aegis community Y" lookup. Brookfield work cannot be threaded to the right Job.
- **Add:** `CommunityAlias { id, communityId, source ('HYPHEN'|'BOLT'|'BWP'|'INFLOW'), aliasValue, note }` with unique `(source, aliasValue)`; back-fill from manual entries; UI on `/ops/admin/hyphen-unmatched` (page exists but appears stub) for one-click mapping.

### P0-4. NUC engine offline — Anthropic credits exhausted since 2026-04-25 23:02 UTC
- **Memory says:** `systems/nuc-cluster.md` — Anthropic API access **disabled** for "Abel Material Partners" org because of out-of-credits. Daily Aegis Morning Briefs since 4/26 show "[Claude unavailable — raw data below]" banner.
- **Platform reality:** `aegis-brain-sync`, `brain-sync`, `brain-sync-staff` crons still firing and erroring every hour. `financial-snapshot` cron failing with raw Prisma error.
- **Gap:** Three cron failures spammed every hour for 3+ days. No alerting/circuit-breaker behavior on Anthropic API outage. Briefs going out broken to Nate's inbox.
- **Add:** Surface "Anthropic credit balance" + "last successful Claude call" on `/ops/admin/system-health`. Add a circuit breaker that pauses brain-sync crons on 3 consecutive Claude failures and emails Nate. **Today's manual fix:** add credits at platform.anthropic.com Billing.

### P0-5. PO import will reintroduce 4:30am-truck-confirmation gap
- **Memory says:** `vendors/boise-cascade.md` 4/24 entry — Abel has **never received 4:30am truck confirmations** for the last couple months despite BC's expectation. Bill Washerlesky forwarded to `BDAgilityMaintenance@bc.com` to fix distribution lists for DALLAS and DALLAS DOOR accounts.
- **Platform reality:** No `vendorPortal`/`truckConfirmation`/`orderAck` model in schema. No way for the platform to know "this PO should have had a truck confirmation by 4:30am and didn't."
- **Gap:** PO confirmation gaps are tracked in Gmail threads, not in Aegis.
- **Add:** `PurchaseOrder.expectedAckBy` + `acknowledgedAt` fields, plus a daily cron that flags POs without ack by SLA window.

---

## P1 — Important gaps

### P1-1. BuilderContact rich data exists but procurement-decision-chain not seeded
- **Memory says:** Doug Gough (Senior Procurement, primary), Kyle Adair (Director of Procurement, CC), Harold Murphy (Procurement Manager, CC) named in Pulte chain. Avery Cadena + Cathleen Richards named for Bloomfield. Amanda Barham + Michael Todd + Oscar Fernandez + Daniel Bennett + Raquel Conner + Cory Finch named for Brookfield.
- **Platform reality:** `BuilderContact` model exists with `firstName, lastName, email, role, isPrimary, receivesPO, receivesInvoice` (good!). `ContactRole` enum has `PURCHASING, OWNER, DIVISION_VP, SUPERINTENDENT, PROJECT_MANAGER, ESTIMATOR, ACCOUNTS_PAYABLE, OTHER` (good!).
- **Gap:** Excellent schema, but the **memory people aren't actually seeded**. No grep for "Doug Gough" or "Amanda Barham" anywhere in repo data. Without seed data, the PMs can't call up "who do I email at Brookfield about Spindletree?" — they're still in Outlook.
- **Add:** Seed script that pulls contacts from memory files (or the `Pulte_BWP_Contacts.csv` referenced in `customers/pulte.md`) into BuilderContact. Mark Brittney Werner's `@pulte.com` as inactive. Mark `kyle.adair@pultegroup.com` as bounced/inactive (mailer-daemon 4/20).

### P1-2. Tier pricing exists in schema but contract-level tiers don't reflect customer reality
- **Memory says:** Pulte got tiered pricing rolled out (`Abel_Lumber_Pulte_Tiered_Pricing_April2026.xlsx`). Bloomfield uses tiered markup ext doors 20%, int doors 26%, trim 35%. P-Card pitches to Entry/Volume/Growth tiers per `p-card-icp-reference.md`. Hardware tiers Builder/Upgrade/Premium are **conversation-starter**, not locked.
- **Platform reality:** `pricingTier String? @default("STANDARD")` on Builder + `PricingTier`/`PricingTierRule` models exist. `ContractPricingTier` model exists.
- **Gap:** Schema is generic (string field). Memory shows real tier names matter — Builder/Upgrade/Premium for hardware, Entry/Volume/Growth for whole-account, % markup by category for custom. Don't see these encoded as enum or with category-level markup support.
- **Add:** Per-category markup on `BuilderPricing` (already exists?), enum for `pricingTier` values, hardware tier matrix surfaced on builder detail page.

### P1-3. Bloomfield "Classic Series" vs "Elements Series" naming not in floor-plan model
- **Memory says:** `customers/bloomfield.md` — Bloomfield has TWO series (Classic, Elements). The 5 bid plans (Carolina, Cypress, Hawthorne, Magnolia, Bayberry) are all Classic Series. Elements Series is a **separate plan lineup** (Woodrose, Camellia, Redbud), NOT a tier within plans. Plan formerly called "Dewberry" was **renamed to Bayberry**.
- **Platform reality:** `CommunityFloorPlan` and `FloorPlan` have `name`, `planNumber`, `sqFootage`, `bedrooms`, etc. No `series` or `productLine` field. No alias / former-name field.
- **Gap:** When Avery sends "Bayberry," PMs/estimators searching for "Dewberry" will whiff. No way to enforce "don't mix Classic and Elements rows in one bid."
- **Add:** `FloorPlan.productLine` (string), `FloorPlan.aliases` (json/array); `Builder.productLines` enumerated.

### P1-4. Tax-exempt builder flag doesn't propagate to invoicing UI/notifications
- **Memory says:** Bloomfield is **tax exempt — do not charge sales tax**.
- **Platform reality:** `Builder.taxExempt Boolean @default(false)` exists at line 38. Used in 10+ files.
- **Gap:** Verify exemption pulls into invoice rendering and quote PDFs, with a visible "TAX EXEMPT" badge on the builder page so PMs don't accidentally add tax in a manual line.
- **Quick win:** UI badge + invoice PDF logic check.

### P1-5. Vendor payment-first-release-after pattern not modeled
- **Memory says:** `vendors/boise-cascade.md` final paragraph — *"Pattern to monitor: BC is operating 'payment-first, release-after' on recent orders. Not a formal credit hold — but the behavior is credit-hold-shaped."*
- **Platform reality:** `Vendor.creditHold Boolean? @default(false)` — binary. No partial-hold or "behavior" tracking. No daily AR-to-vendor reconciliation cron.
- **Gap:** Aegis can't predict "this PO will be held until we wire $X" — it's all in Thomas's head + Gmail.
- **Add:** `VendorBalanceHistory` time-series + `VendorReleaseRule` (e.g., "POs > $5K need payment-first since 2026-03-01"). Surface on vendor detail page.

### P1-6. Curri integration killed in code but `/ops/delivery/curri` still listed in nav
- **Memory says:** `projects/delivery-partners.md` — Curri **deferred 2026-04-22**. In-house drivers handle all deliveries.
- **Platform reality:** `src/app/ops/delivery/curri/page.tsx` exists (now a stub message), `src/lib/integrations/curri.ts` still in tree, `CURRI_API_KEY` already removed from env.
- **Gap:** Dead code path + UI stub. Confusion risk. Decision is final per memory.
- **Quick win:** Delete `/ops/delivery/curri/`, `/api/ops/delivery/curri/`, `src/lib/integrations/curri.ts`, and the curri probe in `/api/ops/delivery/dispatch/`.

### P1-7. QuickBooks decision (QBO not QBWC) not fully reflected in schema
- **Memory says:** `projects/quickbooks-decision.md` 2026-04-22 — **Kill QBWC, go QBO**. New env vars are `QBO_*`. Phase-2 stub returns `not implemented`.
- **Platform reality:** `QBSyncQueue` model still in schema (line 5134) — listed as dead in `systems/abel-os.md`. References to `qbListId`, `qbSyncedAt`, `qbTxnId` (Builder + PO) suggest the original sync intent.
- **Gap:** Either drop `QBSyncQueue` or wire it under the QBO oauth flow. The "Connect QuickBooks" button is disabled with tooltip — that's correct, but the dead model wastes mental space.
- **Add:** Drop `QBSyncQueue` from schema in next migration. Add migration note: "Replaced by Phase-2 OAuth-based QBO sync."

### P1-8. Two-hub geographic ICP not in schema
- **Memory says:** `projects/p-card-icp-reference.md` — service radius is two hubs: **Grand Prairie / Arlington (south)** + **Gainesville (north)**. Outside footprint = disqualifier.
- **Platform reality:** `Builder.territory String?` (free text) and `Builder.divisionId String?` exist. No `serviceHub` enum, no geographic-distance check.
- **Gap:** When Dalton qualifies a custom builder lead, no programmatic ICP filter. Sales pipeline doesn't reject out-of-radius prospects automatically.
- **Add:** `Builder.serviceHub` enum (`SOUTH_HUB`, `NORTH_HUB`, `OUT_OF_RADIUS`); driving-distance field on `Deal`/`BuilderApplication`.

### P1-9. P-Card (Hancock Whitney revolving) is a real product but no platform plumbing
- **Memory says:** `projects/p-card-icp-reference.md` — Abel Builder P-Card is a HW-issued revolving business credit card, per-account underwriting, the **wedge for custom-builder outreach**. Application turnaround "quick" but unconfirmed; rates/rebates/decline-flow all pending.
- **Platform reality:** Zero references to P-Card, builder-card, or HW underwriting in `src/`. `BuilderApplication` model exists (Builder self-registration) but no `pCardApplicationStatus`, no link to HW.
- **Gap:** The wedge for the custom-builder push has no platform UI. Dalton's accounts can't track "P-Card applied / approved / declined / limit."
- **Add (Phase 2):** `BuilderApplication.pCardRequested Boolean`, `BuilderPCard { builderId, hwApplicationId, status, creditLimit, applicationDate, approvalDate }`; UI on builder detail page.

### P1-10. Brookfield/Pulte code-name → Abel SKU mapping isn't first-class
- **Memory says:** `customers/brookfield.md` 4/17 — Amanda asked Nate to "follow what Ben had to make the new pricing transition easy." Code mapping: `FNSBUILT` → Turnkey Interior Doors & Trim Material; `FNSHLBR2` → Turnkey Interior Trim Labor 2.
- **Platform reality:** Searching shows `FNSBUILT`/`FNSHLBR` only in `AUTOMATIONS-HANDOFF.md` and a take-action route. Not in `Product` / `BuilderCatalog` schema.
- **Gap:** Builder-specific SKU/code aliases live in human memory + spreadsheets. When Brookfield references `FNSBUILT` on a PO, Aegis doesn't auto-map.
- **Add:** Reuse `BuilderCatalog` (line 3750) to seed builder-side codes with mapping to Abel `Product` rows.

### P1-11. Brand voice rules not enforced in any external-facing UI/email
- **Memory says:** `brand/voice.md`, `messaging-pillars.md`, `audiences.md` are all binding for external comms. Six pillars. Six audiences (production builder, BTR, custom, banker, vendor, internal, homeowner). "Best-in-class," "world-class," exclamation points outside social — banned.
- **Platform reality:** `EmailQueue`, `Notification`, `BuilderNotification` models exist. No brand-voice linter in any drafting flow. No audience tag on outbound email.
- **Gap:** Aegis-generated emails (delivery confirmation, invoice notifications) have no enforced voice. Marketing/outreach drafts likewise.
- **Add (P2):** `OutreachTemplate.audience` (enum matching brand/audiences.md); CI check that flags banned phrases ("solutions provider," "passionate about," exclamation in subject lines).

### P1-12. AMP naming inconsistency (Material Partners vs Material Planning)
- **Memory says:** `glossary.md` — AMP = **Abel Material Partners**, never "Material Planning." Several legacy file names use "Material_Planning" but brand-correct is "Material Partners."
- **Platform reality:** `Material Partners`/`Material Planning` not surfaced as a UI label; appears in HW pitch ETL scripts only. NUC engine error mentions "Abel Material Partners" org name in Anthropic billing.
- **Quick win:** Audit any UI string mentioning AMP or Material to ensure it's "Material Partners."

---

## P2 — Quality-of-life

### P2-1. Brittney Werner's role-from-Pulte intel not surfaced in UI
- **Memory says:** Brittney is ex-Pulte Vendor Coordinator. She **knows Pulte's internal systems cold**. This is a meaningful relationship asset.
- **Platform reality:** Staff model has `notes` field but no "former employer" / "domain expertise tags."
- **Add:** `Staff.expertiseTags` (json array); could power "who at Abel knows about [builder]?"

### P2-2. 2026 Contracted accounts index not seeded
- **Memory says:** `customers/2026-contracted-accounts.md` — $9.9M contracted base, 8+ named accounts (Shaddock $3M, Olerio $2.1M, Toll $1.8M, MSR $1.4M, etc.). Most lack memory files.
- **Platform reality:** Builder model exists but doesn't appear seeded with these accounts.
- **Add:** Seed script driven by `Hancock Whitney Pitch - April 2026/` slide 4. Each named account becomes a `Builder` row with `Contract` rows attached.

### P2-3. Five custom-builder presentations exist (Desco, J. Anthony, Bella, Alford, Lingenfelter) but not Deal-tracked
- **Memory says:** `projects/custom-builder-outreach-playbook.md` — 5 custom builders already drafted at HTML-pitch level, not yet pressure-tested against ICP.
- **Platform reality:** `Deal` model + `/ops/sales/pipeline` exist.
- **Add:** Seed these as PROSPECT-stage Deals, owner = Dalton.

### P2-4. Glossary acronyms not used as UI labels
- **Memory says:** `glossary.md` — ADT, AMP, BWP, HW, MRP, BoM, BTR, etc.
- **Platform reality:** UI uses generic labels. Internal users use shorthand.
- **Quick win:** Glossary tooltip component on key labels (`<Term def="Bill of Materials">BoM</Term>`).

### P2-5. Job ticket → photo / blueprint / hardware schedule attachment workflow
- **Memory says:** `customers/brookfield.md` — TRIM1 Q/A walk notes for Swallowtail/Spindletree shared via Gmail with attachments.
- **Platform reality:** `DocumentVault` exists. Attaching to a Job/Visit walk has UI?
- **Gap:** Verify a PM can attach walk-photos to a Job, tag who they were sent to (Oscar Fernandez, Michael Todd), and date-stamp.

### P2-6. Hancock Whitney bank-relationship dashboard
- **Memory says:** `projects/hancock-whitney-line-renewal.md` — pitch deck April 2026, line renewal in flight; HW = the bank.
- **Platform reality:** No "external relationships" or "credit lines" model. `CreditLineTracker` model exists (line 4249) — verify it's wired.
- **Add:** Seed HW into `CreditLineTracker`. Show on `/ops/finance/cash` or executive dashboard.

### P2-7. Heim BBQ 4/28 in-person agenda items aren't tasks
- **Memory says:** `vendors/boise-cascade.md` — 4/28 lunch agenda built (overpayment $92,392, pallet pricing review, PO release, service reliability).
- **Platform reality:** Tasks exist; no link to a vendor "meeting prep" entity.
- **Add:** Vendor-meeting prep template — generates Tasks against an upcoming `AccountTouchpoint` (model already exists, line 2620).

### P2-8. Brand asset / Canva folder not surfaced in Aegis
- **Memory says:** `brand/README.md` — Canva brand kit `kAHFqbMow_c` and folder `FAHHODMKS7I`. Logos at workspace root.
- **Platform reality:** No "brand kit" link or asset library in Aegis.
- **Add:** `/ops/marketing/brand` page linking to canonical assets and the brand_dna.json source-of-truth.

### P2-9. NUC cluster → Aegis Command Hub UI missing
- **Memory says:** `systems/nuc-cluster.md` — Command Hub pages should exist at `src/app/business/[id]/{engine,knowledge,actions,config}`.
- **Platform reality:** `src/app/ops/scan` and `src/app/ops/inbox` exist. Verify these are the Command Hub or that Command Hub is dark.
- **Gap:** Even if the engine is offline (P0-4), the UI to view findings/scores/actions should be functional.

---

## Quick wins (<30 min fixes)

1. **Mark Pulte status to LOST** — manual SQL update once `LOST` enum value is added: `UPDATE "Builder" SET status='LOST', "lostDate"='2026-04-20', "lostReason"='Treeline → 84 Lumber per Doug Gough' WHERE "companyName" ILIKE 'Pulte%'`. (P0-1)
2. **Mark Brittney's `brittney.werner@pulte.com` BuilderContact as inactive.** (P1-1)
3. **Mark `kyle.adair@pultegroup.com` BuilderContact as inactive (bounced 4/20).** (P1-1)
4. **Tax-exempt UI badge on Bloomfield builder page.** (P1-4)
5. **Delete `/ops/delivery/curri`, `src/lib/integrations/curri.ts`, dispatch route's curri probe.** (P1-6)
6. **Drop `QBSyncQueue` model in next migration.** (P1-7)
7. **Add Anthropic credit balance + last-Claude-call to `/ops/admin/system-health`.** (P0-4)
8. **Pause `aegis-brain-sync` / `brain-sync` / `brain-sync-staff` / `financial-snapshot` crons until P0-4 fixed.** (P0-4)
9. **Verify import-hyphen route imports from `src/lib/hyphen/parse-dollar.ts` and resume the 15-min cron.** (P0-2)
10. **Add `vitest` + `@vitest/coverage-v8` to `package.json` devDependencies.** (P0-2)
11. **Rename "Bloomfield Dewberry" to "Bloomfield Bayberry" wherever it appears as a FloorPlan.** (P1-3)
12. **Glossary tooltip helper component** (`<Term def=…>BoM</Term>`). (P2-4)
13. **Audit AMP UI strings — ensure "Material Partners," not "Material Planning."** (P1-12)

---

## Stale/wrong intel in memory files

1. **`customers/2026-contracted-accounts.md`** — Bloomfield is shown 85% probability + onboarding. As of `customers/bloomfield.md` 2026-04-28, Bloomfield is in pricing-back-and-forth with Avery; bid sheet is **ready to send**, not yet sent or won. Reconcile.
2. **`customers/pulte.md`** — Says "Brittney Werner — Abel Project Manager hired 1/26/2026" but elsewhere (e.g. `people/abel-team.md`) confirms same. Memory consistent here. **However**, `customers/pulte.md` says contact `brittney.werner@pulte.com` is "likely stale — verify whether that contact is stale" — this should be marked unambiguously stale (it has been since her 1/26/2026 hire date).
3. **`glossary.md` — "Legacy years" inconsistency.** `brand_dna.json` says 41 years; messaging-pillars says "41-year legacy / since 1984." 2026 − 1984 = **42**. Already flagged in glossary.md but unresolved.
4. **`brand/voice.md` "fourth-generation Texas builder"** — voice persona, not literal claim; flagged in glossary. Continue to enforce: never write "Abel is a fourth-generation company."
5. **`projects/hancock-whitney-line-renewal.md`** — "Last updated: 2026-04-18." HW pitch was sent / discussed since then per CLAUDE.md and `vendors/boise-cascade.md` references — refresh status.
6. **`projects/mg-financial-litigation.md`** — Settled 4/21 at $5K. CLAUDE.md still says "Active litigation" / "Evidence package in flight." Reconcile master CLAUDE.md.
7. **`systems/abel-os.md`** — "Models actively used 47 / 58 (81%)." Schema actually has ~120+ models per recent count. Either the unused-model list grew or the doc is stale.
8. **`brand/audiences.md`** — references `BUILDER, Pro Builder, Texas Architect` for media (long-term) — not stale, but flagged as "not active audience today" — fine.
9. **`systems/nuc-cluster.md`** — Worker NUCs status "NOT DEPLOYED" still accurate; coordinator NUC offline due to credit exhaustion (P0-4) makes the "ONLINE" status partly false. Recommend a `degraded` status pattern.

---

> **Total findings:** 5 P0 · 12 P1 · 9 P2 · 13 quick wins · 9 stale-intel notes
> **Next action:** Hand to platform team. P0-2 (parseDollar) and P0-4 (Anthropic credits) are launch-blockers if Monday 2026-04-28 go-live demands clean dashboards and working briefings.
