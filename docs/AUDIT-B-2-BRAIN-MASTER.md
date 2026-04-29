# AUDIT B-2 — Brain Master vs. Aegis Platform

**Date:** 2026-04-28
**Auditor:** Claude (Aegis platform team)
**Scope:** `brain/master/`, `brain/businesses/abel-lumber.md`, `brain/accounts/`, `brain/secrets/POLICY.md`, `brain/evidence/abel-brand-wins.md`
**Goal:** Identify where the brain holds intel that the platform does not surface, enforce, or persist.
**Launch:** Monday 2026-04-28 — gaps are categorized P0 (block launch), P1 (next sprint), P2 (backlog).

---

## P0 — Launch-blocking gaps

### P0-1 — No margin floor enforcement on quote send
**Brain says (`cross-context-principles.md` #23, `decision-patterns.md` Pattern 7, HW pitch slide 9):**
> "Margin governance > revenue chasing. Floor GM review before quotes ship is a standing HW commitment."

**Platform reality:** `Quote.marginPercent` is a stored *output* (line 516, drifted column), not an enforced *input*. `AccountCategoryMargin.minMargin` (default 0.15) and `AccountMarginTarget.targetBlendedMargin` (default 0.30) exist as **data** at `prisma/schema.prisma:2578` and `:2594`, but a grep across `src/` for `marginFloor|enforceMargin|minMargin|marginBlock` returns **no enforcement code**. The Pulte April-2026 commitment (8 operational commitments, monthly scorecards) has been pitched to a bank as a structural promise — and Aegis has the table for it but doesn't gate quote SEND on the floor.

**Gap:** Quotes can ship below `minMargin` without a block, an override reason, or an audit-log row. This is a HW renewal commitment Nate has *already pitched in writing*.

**Fix:** Add a `validateQuoteMargin()` guard in the quote SEND path that compares `Quote.marginPercent` against the linked `AccountCategoryMargin.minMargin` (or `AccountMarginTarget.targetBlendedMargin` as fallback), blocks below-floor sends without `overrideReason`, and writes an `AuditLog` row with severity `WARN` on overrides.

### P0-2 — Vendor concentration risk has no platform alarm
**Brain says (`cross-context-principles.md` #24, `abel-lumber.md`):**
> "Concentration is a risk, not a relationship. Boise Cascade = 37.8% of PO spend is a flagged concentration."

**Platform reality:** `Vendor` model has all the right fields (`creditHold`, `paymentTermDays`, `creditLimit`, `creditUsed`) at `prisma/schema.prisma:1600`, and `VendorScorecard` exists at `:5832`. Concentration text appears in `src/app/ops/supply-chain/page.tsx` and `src/app/api/ops/supply-chain/route.ts`, but there is **no Vendor-level concentration % stored**, no threshold alert, and no surfaced metric on the executive dashboard tying spend share to risk.

**Gap:** The HW pitch named 37.8% Boise concentration as the risk story; the platform doesn't compute or display it as a watch item.

**Fix:** Add a daily cron that updates `VendorScorecard` with `spendShare` (PO YTD ÷ total PO spend) and raises an `AccountReviewTrigger` (or equivalent) when any vendor crosses 30%. Surface on `/ops/supply-chain` and `/ops/executive`.

### P0-3 — Owner equity / cap table not represented post-Josh-buyout
**Brain says (`brain/master/nate.md`, `relationships.md`, `brain/accounts/legal-docs.md`):**
> "Joshua Barrett — bought out April 2026. Ownership today: 0%. Nate 2/3 / Clint Vinson 1/3."

**Platform reality:** No `equityPct`, `isOwner`, or `ownerType` field exists in `Staff`, no cap-table model, no surface in `/admin/`. Josh is presumably still flagged ACTIVE in `Staff` for the temporary sales transition, but the platform has no representation that he is no longer an owner. The HW pitch and the Pulte proposal both lean on the "cleaner ownership structure" narrative; Aegis can't confirm it.

**Gap:** A banker, an auditor, or a new staff member looking at Aegis cannot see who the owners are.

**Fix:** Either (a) add a one-row `OwnershipRecord` model (`staffId`, `equityPct`, `effectiveDate`, `endDate`, `notes`) so the buyout is on record with the April 2026 date, or (b) add `equityPct` + `isOwner` columns to `Staff` and seed the three current ownership rows. Either way, expose on a simple `/admin/ownership` page.

---

## P1 — Next-sprint priority

### P1-1 — Top 2026 contracted accounts not in Builder table or seeded
**Brain says (`abel-lumber.md`, `relationships.md`):**
> Contracted 2026 base $9.9M: Shaddock ($3M), Olerio ($2.1M), Toll Brothers ($1.8M), MSR/Sorovar-Frisco ($1.4M), Imagination, RDR, Joseph Paul, True Grit. **"Memory gap: Toll Brothers / Shaddock / Olerio / MSR not yet in `memory/customers/`."**

**Platform reality:** Seed files (`prisma/seeds/seed-builders.ts`, `seed-builder-pricing.ts`) reference Bloomfield, Brookfield, Pulte. A search for "Shaddock", "Olerio", "Toll Brothers", "MSR" finds **only** Bloomfield/Brookfield/Pulte references. These four accounts are **70%+ of contracted 2026 revenue** ($8.3M / $9.9M) and are not Builder records.

**Gap:** Launch Monday with $8.3M of contracted revenue not represented as Builder rows means quotes/POs/jobs for these accounts are either being created against ad-hoc Builder records or aren't flowing through Aegis at all.

**Fix:** Seed Builder rows for Shaddock, Olerio, Toll Brothers, MSR/Sorovar-Frisco, Imagination, RDR, Joseph Paul, True Grit, and the 7 additional smaller accounts. Pull contact data from the HW pitch deck and `Brookfield/`-style folders.

### P1-2 — Pulte procurement chain (Doug, Kyle, Harold) not in BuilderContact
**Brain says (`relationships.md`, `abel-brand-wins.md`):**
> Doug Gough (Sr Procurement) — primary; Kyle Adair (Director) — CC; Harold Murphy (Manager) — CC. April 2026 letter "Dear Doug" with Kyle/Harold threaded into commitments.

**Platform reality:** `BuilderContact` model exists at `prisma/schema.prisma:193`. The April 2026 Pulte proposal — the highest-stakes external doc Abel sent this year — names three people who must exist in the Builder/BuilderContact tables for any followup, scorecard, or QBR to route correctly. Brain note explicitly flags this: *"`memory/customers/pulte.md` doesn't highlight Doug Gough, Kyle Adair, Harold Murphy as the April 2026 procurement-decision chain."*

**Fix:** Seed BuilderContact rows for Doug/Kyle/Harold linked to the Pulte Builder record, with role tags (`PROCUREMENT_PRIMARY`, `PROCUREMENT_DIRECTOR`, `PROCUREMENT_MANAGER`) and the April 2026 proposal date as `lastTouched`.

### P1-3 — Hancock Whitney commercial banker / loan covenants not represented
**Brain says (`accounts/banking.md`):**
> "Relationship contact: TODO — identify the specific HW commercial banker running the 2026 line renewal review."
> Term debt details: HW 4133 ($128.6K cash pay 2025), HW 6582 ($41.9K), HYG Forklift ($5K).
> Committed cadences: monthly close, weekly AR/AP review, margin governance.

**Platform reality:** `/ops/finance/bank/` page exists (`src/app/ops/finance/bank/page.tsx`) but no `BankRelationship`, `LoanCovenant`, or `CovenantCheck` model in schema. The HW renewal pitch *commits Abel* to specific reporting cadences as part of the renewal decision; the platform doesn't track whether those cadences are actually being met against the covenant dates.

**Fix:** Add a lightweight `BankRelationship` (institution, banker name, contacts) + `LoanFacility` (HW 4133, HW 6582 etc.) + `CovenantCheckpoint` (month, status, lastSubmitted) trio. Surface on `/ops/finance/bank/`. Also create a Vendor-style record (or BuilderContact pattern) for the HW commercial banker once Nate names them.

### P1-4 — Audit log doesn't capture `chat_id` / brain provenance
**Brain says (`cross-context-principles.md` #16):**
> "Instrument everything. Abel OS has an audit log. The NUC has a decision trail. The MCP now forwards chat_id."

**Platform reality:** `AuditLog` (`prisma/schema.prisma:3475`) has `staffId`, `action`, `entity`, `entityId`, `details`, `severity` — but no `source` field for "human" vs. "agent" vs. "NUC scan", no `chatId`, no `actionId` linking back to NUC `actions/` proposals.

**Fix:** Add `source` (HUMAN | AGENT | CRON | NUC | SYSTEM), `correlationId`, and `originalChatId` columns. Backfill existing rows with HUMAN. Required for the agent-fleet handoff Phase 1 anticipates.

### P1-5 — Customer concentration mirror of P0-2
**Brain says:** Pulte H2 2025 73% revenue drop is the structural risk story for 2025. Going forward, Lennar at 45% probability and $10.9M weighted, plus Bloomfield at 85% / $5.6M, would create new concentration if landed.

**Platform reality:** No customer concentration metric on `/ops/executive/` or `/ops/builder-health/`. `BuilderIntelligence` model exists at `:3762` but does not track share-of-revenue.

**Fix:** Same pattern as P0-2 — add `revenueShare` to `BuilderIntelligence`, raise an `AccountReviewTrigger` when any builder crosses 25%.

---

## P2 — Backlog / nice-to-have

### P2-1 — June 2026 protected family corridor not on platform calendar
**Brain says (`life-context.md`, `nate.md`):**
> "Treat June 2026 as a protected corridor — no major work commitments, travel, or launches scheduled into June 2-16 without Nate's explicit acceptance."

**Fix:** Add a `BlackoutWindow` row or a feature flag `JUNE_2026_PROTECTED_CORRIDOR=true` that warns when a delivery / install / QBR is scheduled June 2-16 for Nate's account.

### P2-2 — Insurance, estate, key-person not surfaced anywhere
**Brain says (`accounts/insurance.md`, `legal-docs.md`):**
> "Important given Abel OS + NUC brain operation: cyber liability TODO, key-person life on Nate TODO, business interruption TODO. Estate documents TODO."

**Fix:** No platform surface yet — but a single `/admin/policies` index page tied to a `Policy` model (carrier, type, policyNumber pointer to 1Password, renewalDate) would surface renewal alarms 60 days out. Lower priority because brain itself is mostly TODO here.

### P2-3 — Brand voice / pillar references not surfaced on outbound copy
**Brain says (`abel-brand-wins.md`, `cross-context-principles.md` #29):**
> "Tune to the reader. Brand voice matters for anything external."

**Fix:** A pre-send hook on outbound emails (`/api/ops/communication-log` etc.) that flags overuse of banned phrases ("best-in-class", "we are excited to announce", "family-owned since 1984"). Could be a 50-line static lint over rendered email body.

### P2-4 — Trim/install subcontractor scorecard mirror gap
**Brain says:** Vendor scorecard pattern applies to all vendors.
**Platform reality:** `TrimVendor` (`:1676`) exists with `rates` JSON — but no scorecard/performance log. Same shape as Vendor needs the same treatment.

---

## Quick wins (under 30 minutes each)

| # | Task | Files |
|---|---|---|
| QW-1 | Seed BuilderContact rows for Doug, Kyle, Harold against the Pulte Builder record | `prisma/seeds/seed-builders.ts` |
| QW-2 | Add `source` enum column to `AuditLog` (additive migration only) | `prisma/schema.prisma:3475` + new migration |
| QW-3 | Wire `Quote.marginPercent < AccountCategoryMargin.minMargin` warning into `/ops/quotes/[id]` UI (read-only banner, not a block — block is P0-1) | `src/app/ops/quotes/` |
| QW-4 | Add `equityPct` column to `Staff` and seed Nate=66.67, Clint=33.33, Josh=0 | `prisma/schema.prisma:881` |
| QW-5 | Update `memory/customers/pulte.md` with the Doug/Kyle/Harold chain (brain-side fix) | `memory/customers/pulte.md` |

---

## Stale intel (brain says X — platform may already have a newer X)

1. **`brain/accounts/services.md` line 19** records the OpenAI key as `abel-claude-bridge` created 2026-04-19. The note about a previously-pasted-and-revoked key is brain-side hygiene — verify no plaintext OpenAI key exists in the platform repo `.env*` files.
2. **`abel-lumber.md` line 35** says "Abel OS — 190K LOC, live April 13, 2026." — confirm the schema/repo line count is still that order of magnitude and that the live-on date is the canonical reference everywhere (e.g., footer, dashboard).
3. **`brain/master/relationships.md` line 37** has Joshua Barrett as `Status: Active (hired 5/1/2021)` plus "Bought out April 2026". The `Staff` table's `active` flag for Josh and his role string should be reconciled — **is he still ACTIVE with role SALES, or has the buyout flipped any state?** Brain says "staying on in sales temporarily."
4. **`abel-lumber.md` line 103** explicitly names the missing customer files (Shaddock, Olerio, Toll, MSR, Joseph Paul, RDR, True Grit, Imagination). These are also the missing Builder rows in P1-1 — same gap, two layers.
5. **`brain/accounts/banking.md` line 44** lists the operating LOC as "currently under renewal." Once the renewal closes, the platform should record the renewal date + facility number on the (proposed) `LoanFacility` model so the next renewal triggers 90 days out.
6. **`brain/master/growth.md`** is mostly TODO. No platform action — flagged so platform team doesn't try to surface intel that doesn't exist yet.

---

## Brain growth-log pulse

Recent additions to the brain (per `Last updated: 2026-04-18` and the April-19 OpenAI key entry):

- **2026-04-18:** Master brain populated; Nate's identity, Josh buyout, Theodore due date, Lilli wedding-anniversary recorded.
- **2026-04-19:** Services file updated with OpenAI key pointer + revocation note.
- **No newer entries** through 2026-04-28 launch date — **growth log freshness is 10 days stale relative to platform launch**. Suggest a brain → platform sync session within 7 days post-launch to capture (a) Pulte April-letter outcome, (b) HW renewal decision, (c) Josh buyout signed-paperwork date, (d) any Brookfield Rev 2 decision.

---

## Summary table of reference points

| Brain assertion | Platform location verified | Status |
|---|---|---|
| Margin floor enforcement | `prisma/schema.prisma:2578-2603` (data); no code enforcement | **P0-1** |
| Vendor credit hold + terms + scorecard | `prisma/schema.prisma:1600,1619,1630,5832` | Schema OK, no concentration alarm |
| Vendor concentration alarm | grep across `src/`: not found as risk metric | **P0-2** |
| Owner cap table | `Staff` model `:881`: no `equityPct`/`isOwner` | **P0-3** |
| Top builders seeded | `prisma/seeds/seed-builders.ts`: only Bloomfield/Brookfield/Pulte | **P1-1** |
| Pulte procurement chain | `BuilderContact` exists `:193`; data not seeded | **P1-2** |
| HW relationship + covenants | `/ops/finance/bank/page.tsx`: no LoanFacility/Covenant model | **P1-3** |
| Audit log source provenance | `AuditLog :3475`: no `source` / `chatId` | **P1-4** |
| Customer concentration | `BuilderIntelligence :3762`: no `revenueShare` | **P1-5** |
| Audit log entity coverage | `AuditLog :3475`: model present, well-indexed | OK |
| `creditHold` on Vendor | `:1630` Boolean default false | OK |

---

> File location: `abel-builder-platform/docs/AUDIT-B-2-BRAIN-MASTER.md`. Pair with `AUDIT-A-MUTATION-SAFETY.md`, `AUDIT-API-REPORT.md`, `AUDIT-DATA-REPORT.md`, `AUDIT-LOG-COVERAGE.md`, `AUDIT-UI-REPORT.md`. AUDIT-B-1 not yet present in this branch.
