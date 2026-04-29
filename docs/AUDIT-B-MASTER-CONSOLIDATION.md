# AEGIS MEGA-AUDIT — Master Consolidation
**Date:** 2026-04-28 (Sunday before Monday launch)
**Sources synthesized:** 14 AUDIT-B reports + 10 SCAN-A reports + 3 role audits (Manufacturing/Delivery/Install) + AUDIT-A mutation safety + 18 workspace AEGIS-* reports
**Total findings reviewed:** ~150 distinct items

---

## Executive summary (read this first)

**Aegis is launchable Monday — but with eyes open about three categories of debt.**

1. **Trust-blocker data drift in Finance.** 3,198 DELIVERED orders without invoices ($6.2M revenue gap). 585 negative invoices misclassified PAID. Order.total stale on 91% of rows ($1.7M drift). Dawn cannot confidently report numbers until these are backfilled. ~3 hours of script-running fixes this.

2. **Cross-role handoff blindness.** Each role's own pages work 60-90%. The information that should flow BETWEEN roles doesn't. Installer can't see delivery status. Delivery can't see manufacturing readiness. Damaged goods discovered on site have no UI capture. This is the biggest structural gap.

3. **Plan-vs-built drift.** 6 strategic docs commit Aegis to multi-tenancy with `Tenant` model + `phase-1` branch + `prod-phase-1` Neon DB — none of which exist. The platform is single-tenant Aegis Supplier. That's fine for Monday (it's Abel's platform), but the gap should be acknowledged before promising builders/customers the "platform" pitch.

**Plus one accidental finding:** prior audits surfaced ~38 still-open issues, many of which were "shipped" in code but not deployed or had silent regressions. The W7 Sentry fix landed, but `globalThis.Sentry` is still dead. The financial-snapshot JSONB cast was committed but verify it's running on prod.

---

## Top 10 P0 launch blockers (impact × effort ranked)

| # | Issue | Source | Effort | Impact |
|---|---|---|---|---|
| 1 | **Pulte still ACTIVE in DB** — account lost 4/20, 21 open POs (~$32.5K) need cancel | B1 | 30 min | Operational/legal — Pulte UI shows in pipeline |
| 2 | **3,198 DELIVERED orders missing invoices ($6.2M)** — auto-invoice cascade now exists for new orders, just need backfill script run | B11 | 30 min | $6.2M AR phantom |
| 3 | **585 negative invoices misclassified PAID** — should be VOID | B11 | 30 min | AR % inflated |
| 4 | **Order.total stale on 91% of rows ($1.7M)** — recompute script exists, just needs to run | B11 | 30 min | Every revenue number lying |
| 5 | **Hyphen IntegrationConfig row missing** + community name mismatch — 0/80 BWP jobs unlinked | B1, B12 | 2-3 hr | Brookfield (top customer) entire integration dark |
| 6 | **`Builder.status` enum missing LOST** — Pulte case + future churn handling | B1 | 30 min | Compliance/reporting |
| 7 | **financial-snapshot cron $20::jsonb cast** — fix shipped in `ec1a7f6`, verify running on prod | B7, B11 | 5 min verify | 6 consecutive failures = no daily AR snapshot |
| 8 | **NUC Anthropic credits exhausted** since 2026-04-25 — 3 brain-sync crons spamming hourly errors, daily briefings broken | B1 | Nate to fund | 3 days dark |
| 9 | **Pile-B 30-route default-deny** (`/api/ops/dashboard`, `/me`, `/search`, `/calendar`, etc.) — every non-ADMIN user 403s on first login | B7 (still-open) | 1 hr | Single biggest user-visible launch risk |
| 10 | **Brain ingest 401 since 4/25** — `BRAIN_API_KEY` mismatch between Vercel and NUC | B7 (still-open) | Nate to rotate | 2 days of NUC events un-ingested |

**These ten alone are 8-10 hours of work + a few env-var rotations Nate handles. All landable before Monday.**

---

## Top 20 P1 (important but not blocking)

| # | Issue | Source | Effort |
|---|---|---|---|
| 11 | **Brookfield Rev 4 plan-level pricing not in engine** — Lisa edits each line manually | B3, B10 | 4 hr |
| 12 | **HyphenSubdivisionMap model + admin UI** — needs CRUD for staff to add new mappings | B3, B12 | 2 hr |
| 13 | **`ContractPricingTier` exists but unused** — wire into quote pricing | B10 | 4 hr |
| 14 | **Quote→Order auto-conversion missing** — APPROVED quote, manual click required | B10 | 2 hr |
| 15 | **Damaged goods capture missing** (installer side) — backcharge flow has no UI | Install audit | 2 hr |
| 16 | **Delivery status invisible to installer** — wasted trips when materials missing | Install audit | 1 hr |
| 17 | **Crew assignment in build sheet** — production lead can't manage team | Mfg audit | 6 hr |
| 18 | **Substitution approval workflow** — picker marks SUBSTITUTED with no audit trail | Mfg audit | 10 hr |
| 19 | **Shortage escalation modal** — daily plan exceptions are display-only | Mfg audit | 6 hr |
| 20 | **Pre-load manifest verification** — driver scans before truck departs | Delivery audit | 1 hr |
| 21 | **Real-time damage reporting (driver→Jordyn)** — currently surfaces 2 hours late | Delivery audit | 1 hr |
| 22 | **Live tracking map** — vaporware on Fleet hub, data exists, UI missing | Delivery audit | 1.5 hr |
| 23 | **Signature stored as text-truncated in Delivery.notes** — legal evidence lost | Install audit | 1 hr |
| 24 | **QC defects don't feed back to install** — installer rebuilds same failure | Install audit | 1.5 hr |
| 25 | **Margin floor not enforced** at quote send (`AccountCategoryMargin.minMargin` unused) | B2 | 2 hr |
| 26 | **Vendor concentration risk metric** — Boise = 37.8% of spend, no alarm | B2 | 2 hr |
| 27 | **750 unpriced products at $0** — `Abel_Products_Needing_Pricing.xlsx` (754 rows) never imported | B8 | 4 hr |
| 28 | **95 pricing corrections unwritten** — partial Brookfield/Toll done, others (AGD, Stately, JCLI, etc.) skipped | B8 | 4 hr |
| 29 | **Two parallel models: Vendor + Supplier** — live page queries Supplier, schema has both | B4 | 6 hr |
| 30 | **EmailQueue table not consumed** — builder notifications create rows that go nowhere | B14 | 30 min decision (drop) or 4 hr (build processor) |

---

## Quick wins — under 30 min each (15 items, all landable in one focused hour)

These are pure value, near-zero risk:

1. **Add `Builder.status = LOST`** enum value + `lostDate`, `lostReason`, `lostToCompetitor` fields (additive migration, 30 min)
2. **Run `scripts/_recompute-order-totals.mjs --apply` on prod** (5 min)
3. **Run invoice issuedAt backfill** (`node scripts/_backfill-invoice-issuedat.mjs --apply`) (5 min)
4. **Mark Pulte builder LOST + cancel 21 open POs** via single SQL script (15 min once #1 lands)
5. **Verify `ec1a7f6` deployed on prod** (financial-snapshot JSONB fix) (2 min)
6. **Verify `c5baff8` deployed on prod** (Phase 4 polish) (2 min)
7. **Add `WEBHOOK` action type to executor** (or strip from UI) — currently crashes if anyone selects (10 min strip / 30 min implement)
8. **Add 'JOB_UPDATE' fallback in `notifyStaff`** for invalid types — already done in this session, verify
9. **Add `result.skipped=true` distinct rendering** on `/admin/crons` — currently SUCCESS hides skipped (30 min)
10. **Seed BuilderContact rows for Doug Gough, Amanda Barham, etc.** from memory files (30 min)
11. **Add `Staff.equityPct` field** + 3 rows (Nate 67%, Clint 33%, Josh 0% post-buyout) (30 min)
12. **Fix `text-xs` → `text-sm` in build-sheet labels** (5 min find-replace)
13. **Add `min-h-[48px]` to all `/ops/finance/*` button classes** (15 min find-replace)
14. **Wire "View Detailed Report" / "Convert to Order" buttons in sales/CRM pages** — endpoints exist, just need wired (30 min)
15. **Strip 5 stub action types from `/ops/automations` UI** (`AI_*`, `SEND_EMAIL`, `UPDATE_STATUS`) — they're no-ops, lying about capability (15 min)

---

## Cross-cutting themes

### Theme 1: Data drift is everywhere
- Finance: $6.2M / $1.7M / 585 misclassified
- Builder: Pulte still ACTIVE
- Pricing: 750 at $0, 95 corrections unwritten
- Hyphen: 0/80 linkage
- Inventory: 80% of catalog has no current onHand

**The pattern:** prior data migrations / ETLs / manual fixes were partial. Multiple "we'll backfill later" decisions that didn't get backfilled.

**Recommendation:** A single "data integrity dashboard" page (`/ops/admin/data-quality/run` exists but scoped narrow) that shows all known drift conditions with one-click repair scripts. Treat data integrity as ongoing, not one-time.

### Theme 2: Cross-role handoffs are the structural gap
- Install can't see delivery status → wasted trips
- Delivery can't see manufacturing readiness → wrong-truck-loaded errors
- Manufacturing has no crew assignment → lead can't manage team
- Damaged goods on jobsite → no UI path → no backcharge

**Recommendation:** Each role's page should include a "what's happening upstream + downstream" panel. Cross-role visibility > single-role completeness.

### Theme 3: Plan-vs-built drift
- 6 strategic docs reference `Tenant` model that doesn't exist
- `phase-1` branch doesn't exist
- Aegis Builder, Platform, Capital are paper-only
- DocumentVault has 14 entity links + working UI but is empty of strategic deliverables (HW pitch, MG evidence, etc.)

**Recommendation:** Either delete or update the strategic docs. Right now CLAUDE.md mandates a `phase-1` branch flow that's been violated by every commit. Either flow is wrong or branch should be created.

### Theme 4: Audit fatigue — many fixes "shipped" but not deployed
- Sentry shim still dead in prod (W7 fix didn't propagate)
- financial-snapshot cron — fix in commit, verify running
- parseDollar Toll Brothers — actually wired (good)
- Hyphen orphan-Job fallback — never shipped despite being on backlog 2 weeks

**Recommendation:** Add a "last shipped commit per area" smoke check. Don't trust "fixed in code" without "verified in prod."

### Theme 5: Mobile is bimodal
- Field roles (Driver, Installer) — gold-standard mobile UX, exemplary
- Office roles (Finance, Admin) — desktop-only, table-heavy
- Hybrid roles (PM, Dispatch) — middle, missing sticky actions

**Recommendation:** OK for launch (office roles use desktops). Build `<ResponsiveAdminTable>` component post-launch as a single fix that affects 12+ admin pages.

---

## By-category breakdown

### Manufacturing (75% complete)
- ✅ Pick scanner, build sheet, QC queue, staging kanban — all real
- ⚠️ Crew assignment missing — production lead can't manage team
- ⚠️ Substitution approval workflow missing
- ⚠️ Shortage escalation display-only
- ⚠️ Inline QC sign-off on build sheet
- ⚠️ Print packet view

### Delivery & Logistics (mixed)
- ✅ Driver Portal — gold standard (56px buttons, offline-aware, signature, photo)
- ✅ Dispatch live polling
- ⚠️ Live Tracking — vaporware
- ⚠️ Route Optimizer — heuristic distance, not real routing API
- ⚠️ Pre-load verification missing
- ⚠️ Real-time damage reporting (driver→Jordyn) — surfaces 2h late

### Install & QC (60% complete)
- ✅ Briefing, schedule, job detail with photo+signature+punch+escalation all wired
- ⚠️ Delivery status invisible
- ⚠️ Damaged goods capture missing entirely
- ⚠️ Signature text-truncated
- ⚠️ QC defects don't feed back
- ⚠️ No time tracking

### Sales / CRM / Quotes (70%)
- ✅ Deal pipeline, quote conversion analytics, takeoff→quote, sales reports, outreach engine
- ❌ Quote→Order auto-conversion (manual)
- ❌ Brookfield Rev 4 plan-level pricing
- ❌ Bloomfield tiered-markup pricing
- ⚠️ No stale-lead alerts
- ⚠️ Quote send/approval workflow undefined

### Finance / AR / AP / Collections (45%)
- ✅ Pages exist, lifecycle DRAFT→ISSUED→SENT→PAID, payment recording, lien releases, collections cycle infra
- ❌ Data drift cluster ($6.2M / $1.7M / 585 / 91%)
- ❌ Collections emails disabled (correct for safety; flip on Monday post-launch)
- ❌ QuickBooks not live (Phase 2 stub — defer)
- ⚠️ Stripe payment-link generation not wired into invoice flow

### Builder Portal (85%)
- ✅ 47 pages wired, orders/quotes/invoices/deliveries/messages/projects/warranty all functional
- ✅ eSignature canvas, payment submission (ACH/Check/Wire), live delivery tracking
- ⚠️ Stripe/card payment missing (defer)
- ⚠️ Brookfield BuildPro integration absent (defer)
- ⚠️ Onboarding not enforced
- ⚠️ Document portal UI missing (API exists)
- ⚠️ Invoice PDF download not exposed

### Hyphen Integration (30% → 95% with 3 hours)
- ✅ parseDollar fix wired correctly
- ✅ HyphenBuilderAlias + HyphenProductAlias work
- ✅ Schedule/order/payment sync code complete
- ❌ IntegrationConfig row missing
- ❌ HyphenSubdivisionMap model + seed missing
- ❌ Community name mismatch unhandled
- ⚠️ No PO orphan-Job fallback (silent drop)

### Customers
- **Brookfield** (top active): 0/80 linked, Rev 4 pricing not in engine, BuildPro codes uncaptured, 11 communities/20 plans not seeded
- **Bloomfield** ($5.6M weighted, 85% prob): 0/9 plans seeded, tax-exempt unverified, tiered-markup not implemented, 23 deliverables in OneDrive only
- **Pulte**: LOST 4/20, status still ACTIVE, 21 POs need cleanup
- **Toll**: parseDollar fix applied (good)
- **9 contracted accounts $9.94M revenue**: missing memory files + likely Builder rows

### Vendors
- **Boise Cascade**: 37.8% of spend = concentration risk, no alarm; AMP spend forecasts not reconciled with platform PO data; Corporate Guaranty + signed price lists exist on disk only
- **General**: Two parallel models (Vendor + Supplier), live page queries Supplier — confusion at launch
- **7 SKUs sold below cost** + **$92K overpayment across 221 SKUs** documented in pricing review, no platform alert

### Strategic / Active Workstreams
- **Hancock Whitney**: pitch deck ready, no platform tracking
- **MG Financial litigation**: evidence package with counsel, no platform tracking
- **AMP / Boise negotiation**: active, no platform tracking
- **Brookfield value engineering**: $1,085/house savings commitment to corporate, unrecorded
- **Catalog cleanup**: 750 unpriced + 95 corrections incomplete
- **Inventory count April**: 20% complete (618/3,106 SKUs)

### Email & Notifications
- 32 paths inventoried, 16 with feature-level kill switches
- ✅ `EMAILS_GLOBAL_KILL` blocks ~80% of paths
- ⚠️ Quote follow-ups, delivery notifications, application temp-password emails lack feature-level kill
- ⚠️ Collections emails use legacy path (no audit trail)
- ⚠️ EmailQueue not consumed (orphaned writes)

### Mobile UX
- Driver/Installer/Builder portals: 80-100% mobile-ready
- Finance/Admin/Manager: 30-35% — table-heavy, desktop-only

### Brain Integration
- NUC Anthropic credits exhausted 4/25 (3 days)
- Brain ingest 401 since 4/25 (BRAIN_API_KEY mismatch)
- Bridge endpoint dual-send fix in HEAD but didn't work
- 0 NucHeartbeat rows ever (waiting on Nate to deploy heartbeat script)

---

## Recommended execution sequence

### Wave 1 — "Stop the bleeding" (Sunday night / Monday early AM, ~3 hours)

**Single-script repair sequence** (Nate runs these in order, no code changes):
1. Run invoice issuedAt backfill — `node scripts/_backfill-invoice-issuedat.mjs --apply` (5 min)
2. Run Order.total recompute — `scripts/_recompute-order-totals.mjs --apply` (5 min)
3. Reclassify 585 negative invoices to VOID via SQL (10 min)
4. Mark Pulte LOST + cancel 21 open POs (15 min — needs new enum value first, see Wave 2)

**Single-key rotations** (Nate's hands):
5. Rotate JWT_SECRET in Vercel
6. Rotate Neon DB password
7. Sync BRAIN_API_KEY between Vercel and NUC
8. Set EMAILS_GLOBAL_KILL=true as launch insurance
9. Verify Stripe webhook URL registered (test event from dashboard)
10. Fund NUC Anthropic credits

### Wave 2 — "Unblock top customers" (Monday after launch, ~5 hours code work)

**Hyphen 0/80 unblock** (~3 hours):
11. Add `HyphenSubdivisionMap` model + migration
12. Update sync queries to use map (left-join pattern)
13. Insert IntegrationConfig HYPHEN row (Nate adds API key)
14. Seed initial Brookfield mapping
15. Add `Builder.status = LOST` enum + columns

**Cross-role wave-1** (~2 hours):
16. Delivery status on installer dashboard
17. Damaged goods capture modal in installer portal
18. Pile-B default-deny route fix (30+ routes get API_ACCESS entries)

### Wave 3 — "Tighten the loop" (Tuesday-Friday, ~10 hours)

19. Crew assignment in build sheet
20. Substitution approval workflow
21. Shortage escalation modal
22. Pre-load manifest verification
23. Real-time damage reporting (driver→Jordyn)
24. Live tracking map (data exists, render it)
25. Signature preservation schema (Installation.signatureDataUrl)
26. QC defects visible on install detail
27. Brookfield Rev 4 plan pricing (stub)
28. Quote→Order auto-conversion button
29. 750 unpriced products ETL
30. 95 pricing corrections completion

### Wave 4 — "Polish + post-launch backlog" (week 2)

- Phase 3B remaining 6 automations (3B.1, 3B.4, 3B.5, 3B.6, 3B.8)
- Stripe payment-link generation
- BuildPro plan codes (Brookfield 20 plans)
- Bloomfield tiered-markup pricing
- Strategic project tracking (`Initiative` model + dashboard)
- Admin table → card responsive component
- EmailQueue decision (drop or implement processor)

### Wave 5 — "Strategic" (post Q2)

- Multi-tenancy spine (`Tenant` model — only if going multi-customer)
- Public Builder API + developers.aegis.build
- Stripe Subscription billing
- QuickBooks Online OAuth integration
- Aegis Capital embedded fintech

---

## What `EMAILS_GLOBAL_KILL=true` should be Monday

Recommend setting it to `true` for launch morning. Then flip to `false` Monday afternoon after spot-checking ~5 emails actually fired correctly to Nate's inbox. By Tuesday EOD, leave it off; per-feature switches govern individual surfaces.

---

## Final notes

**The single highest-leverage hour you have:** running Wave 1 scripts. Three commands and your AR/AP numbers stop lying.

**The single highest-leverage 3 hours:** Wave 2 Hyphen unblock. Brookfield (top customer) entire integration goes live.

**The thing you cannot defer:** Pile-B 30-route default-deny. If non-ADMIN users 403 on first login Monday, the launch story is "the platform doesn't work for staff." 1 hour fix.

**The thing you can defer the longest:** strategic doc reconciliation. Multi-tenancy + phase-1 branch + Aegis Builder are all paper. Either build them or delete the docs. Nobody outside this team needs to know.

---

**End of consolidation. 14 audit reports + 10 SCANs + 3 role audits = ~27 source documents synthesized. Top 30 items prioritized. Quick wins enumerated. Sequence proposed.**
