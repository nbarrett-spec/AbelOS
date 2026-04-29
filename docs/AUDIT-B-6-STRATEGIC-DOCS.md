# Audit B-6 — Strategic Planning Docs vs Shipped Code

**Date:** 2026-04-28 (Monday launch day)
**Scope:** All `Aegis_*.md` and `ABEL-*.md` planning docs in workspace root vs. `abel-builder-platform/` repo
**Reading method:** Skimmed each doc for spec'd modules, then surveyed `src/app/`, `src/lib/`, `prisma/schema.prisma`, `src/components/`, `vercel.json` for evidence.
**Method note:** "BUILT" = page directory or model exists and looks wired. "PARTIAL" = scaffold or model present but spec contract unmet. "MISSING" = no code evidence.

---

## Plan-vs-Built Status Matrix

| Plan doc | Module spec'd | Status | Note |
|---|---|---|---|
| **ABEL-OS-ROADMAP.md** | P0 — Audit log to 100% mutations | PARTIAL | `src/lib/audit.ts` + `AuditLog` model exist; coverage was ~11%. `docs/AUDIT-LOG-COVERAGE.md` exists tracking sweep. |
| ABEL-OS-ROADMAP.md | P0 — Webhook hardening (HMAC + idempotency) | PARTIAL | `WebhookEvent` model now in schema (line 3065); `src/app/api/webhooks/{gmail,hyphen,inflow,stripe}` present. Idempotency keys partially wired. |
| ABEL-OS-ROADMAP.md | P0 — Delete dead models | PARTIAL | `QBSyncQueue`, `AccountReviewTrigger`, `AccountTouchpoint`, `DealActivity`, `DocumentRequest` STILL in schema — not deleted. `DEAD-MODEL-REPORT.md` produced. |
| ABEL-OS-ROADMAP.md | P0 — Outreach schema drift fix | BUILT | `OutreachSequence`, `OutreachStep`, `OutreachEnrollment`, `OutreachTemplate` now Prisma-modeled (lines 2934–3023). |
| ABEL-OS-ROADMAP.md | P1 — `/ops/purchasing` UI | BUILT | `src/app/ops/purchasing/` exists. |
| ABEL-OS-ROADMAP.md | P1 — Sales CRM `/ops/sales/pipeline` | PARTIAL | `src/app/ops/sales/` exists; `Deal` + `DealActivity` models present; pipeline kanban depth unverified. |
| ABEL-OS-ROADMAP.md | P1 — Collections automation cron | BUILT | `src/app/api/cron/collections-cycle/`, `collections-email/`, `collections-ladder/` exist. `CollectionRule` + `CollectionAction` models present. |
| ABEL-OS-ROADMAP.md | P1 — Cron observability `/ops/admin/crons` | PARTIAL | `CronRun` model exists (line 3088); admin page presence unverified in `src/app/ops/admin/`. |
| ABEL-OS-ROADMAP.md | P1 — QBSyncQueue decision | NOT BUILT | Model still exists, no implementation. Decision deferred. |
| ABEL-OS-ROADMAP.md | P2 — Unified inbox `/ops/inbox` | BUILT | `src/app/ops/inbox/` exists; `InboxItem` model (line 3146); `inbox-feed` cron. |
| ABEL-OS-ROADMAP.md | P2 — Financial command center | BUILT | `src/app/ops/command-center/` + `src/app/ops/finance/` exist; `FinancialSnapshot` model + cron. |
| ABEL-OS-ROADMAP.md | P2 — Data quality watchdog | BUILT | `DataQualityRule` + `DataQualityIssue` models; `data-quality` + `data-quality-watchdog` crons. |
| ABEL-OS-ROADMAP.md | P2 — AI agent surface `/ops/ai/agent` | BUILT | `src/app/ops/ai/` + `src/app/ops/agent/` exist; `agent-hub` API tree present. |
| **AEGIS-VS-LEGACY-GAP-ANALYSIS.md** | Auto-reorder PO generation | PARTIAL | `AutoPurchaseOrder` + `SmartPORecommendation` models exist; `auto-po` page; trigger logic depth unverified. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Stock transfer UI | PARTIAL | `StockTransfer` + `StockTransferItem` models present; UI in `src/app/ops/` not visible at top level. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Inventory valuation (FIFO/avg) report | NOT BUILT | No valuation module evident. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Credit hold enforcement | BUILT | `src/lib/credit-hold.ts` exists. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Job costing with labor hours | NOT BUILT | No labor-hours model; no WIP module. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Landed cost tracking | NOT BUILT | No freight/duty allocation model. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Lien release workflow | PARTIAL | `LienRelease` model + `src/app/ops/lien-releases/` page exist. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | QB sync (build or kill) | NOT BUILT | Models linger; no working sync; decision still pending. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | MRP / demand planning | BUILT | `src/lib/mrp/`, `src/app/ops/mrp/`, `mrp-nightly` cron, `DemandForecast` model. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Supplier scorecards (detailed) | BUILT | `VendorPerformance`, `VendorPerformanceLog`, `VendorScorecard` models exist. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Lot traceability / serial #s | NOT BUILT | No batch/serial tracking model. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Deal pipeline weighted forecast | PARTIAL | `Deal` model has stage; weighted forecast logic not evident. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Document eSignature | NOT BUILT | `DocumentRequest` exists, no signing flow. `DocumentVault` model added but no DocuSign-equivalent. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Subcontractor management / 1099 | NOT BUILT | No Subcontractor entity. `SubcontractorPricing` exists in isolation. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | NPS / customer satisfaction | NOT BUILT | No survey model. `DeliveryFeedback` is the closest. |
| AEGIS-VS-LEGACY-GAP-ANALYSIS.md | Time & labor tracking | NOT BUILT | No shift/timecard model. |
| **AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md** | M1 — Tenant model + RLS + SSO | NOT BUILT | **No `Tenant` model in `prisma/schema.prisma`. No `tenantId` columns. No Stytch SAML/OIDC in code. JWT auth (`jose`) still in use. RLS not enabled.** |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M2 — Onboarding wizard self-serve | PARTIAL | `src/app/dashboard/onboarding/` exists but self-serve signup/payment flow not wired. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M3 — Community / Phase / Release | PARTIAL | `Community` model exists; `Phase` / `Release` are missing as discrete models (only `JobPhase`, `BuilderPhaseConfig`). |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M4 — Plan library + version diff | PARTIAL | `Blueprint` + `FloorPlan` + `CommunityFloorPlan` models exist; no `PlanVersion` diff model. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M5 — Takeoff approval workflow | PARTIAL | `Takeoff` + `TakeoffItem` + `TakeoffInquiry` models; redline/version-lock workflow unclear. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M6 — Option / VPO desk | NOT BUILT | No `OptionPackage`, `OptionPackageItem`, `LotOptionPackage` models. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M7 — Lot lifecycle | PARTIAL | No discrete `Lot` model — `Job` doubles as lot. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M10/11 — Delivery POD signed + photos | PARTIAL | `Delivery` + `DeliveryTracking` models; no separate `DeliveryPOD` / `DeliveryPhoto` / `ShortReport` models. `SignaturePad` component exists. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M11 — Dispute + CreditMemo | NOT BUILT | No `Dispute` model. No `CreditMemo` model. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M12 — Statement runs | NOT BUILT | No `StatementRun` / `StatementInvoiceLink` models; `src/app/dashboard/statement/` page is per-builder view only. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M13 — Stripe ACH + batch pay | PARTIAL | `src/lib/stripe.ts` + `webhooks/stripe` exist; batch pay UI (`src/app/dashboard/cart/`, `payments/`) present. ACH self-serve depth unverified. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M14 — Threaded messaging | PARTIAL | `Message` + `Conversation` + `BuilderMessage` models exist; no separate `Thread` / `Post` model from spec. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M22 — Public Builder API `/v1/*` | NOT BUILT | No `src/app/api/v1/` route tree. `ApiKey`, `OAuthApp`, `Webhook` models from spec absent. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M23 — Stripe subscription billing | NOT BUILT | No `Subscription` / `SubscriptionItem` models. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M24 — Posthog activation funnels | NOT BUILT | No `UsageEvent` model; Posthog dep not visible. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M25 — `developers.aegis.build` portal | NOT BUILT | No external developer site. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M26 — Marketing site `aegis.build` | NOT BUILT | No marketing site routes. Only `app.abellumber.com`. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M28 — Aegis Copilot v1 | PARTIAL | `AgentChat.tsx`, `agent-hub/*`, `CopilotBar` (ui-v2) exist; tenant-scoped Q&A flow unverified. |
| AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md | M30 — Security/compliance portal | NOT BUILT | No in-product security overview, no SOC 2 self-serve. |
| **AEGIS_TIER_DRIVEN_BUILD_PLAN.md** | `TenantProfile` Prisma model | NOT BUILT | No `TenantProfile` model in `prisma/schema.prisma`. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | `src/lib/builder-tiers.ts` matrix | BUILT | File exists with full taxonomy types. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | `src/lib/tier-matrix.ts` | NOT BUILT | File not created. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | `src/hooks/useTenantProfile.ts` | NOT BUILT | Hook file not present. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | Tier-aware middleware | NOT BUILT | `middleware.ts` does not gate routes by tier (no Tenant model to read from). |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | `prisma/seed-tenant-profiles.ts` (27 accounts) | NOT BUILT | No tenant-profile seed script. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | T1 / T5 home variants | NOT BUILT | Single `aegis-home` page; no tier-conditional widget stack. `TenantSwitcher.tsx` component exists in ui-v2 but no backing system. |
| AEGIS_TIER_DRIVEN_BUILD_PLAN.md | Auto-promotion cron `tier-reclassify.ts` | NOT BUILT | No such cron in `vercel.json`. |
| **AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md** | 27-tenant provisioning | NOT BUILT | No tenant model means no tenants provisioned. Builders exist as flat `Builder` rows. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | B1–B14 P0 bug fixes | PARTIAL | Some fixed (`outreach` schema drift); status of enum casts and lat/lng migrations unverified. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | RLS test suite | NOT BUILT | No `tests/rls/` directory; `tests/` folder absent at top level. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | Hyphen 80%+ link rate | NOT BUILT | `HyphenAccessToken`, `HyphenBuilderAlias`, `HyphenCredential`, `HyphenOrder*`, `HyphenPayment`, `HyphenProductAlias`, `HyphenDocument` models exist; cron present; per CLAUDE.md still 0/80 linked at Brookfield. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | Stytch SAML + OIDC builder invite | NOT BUILT | No Stytch in `package.json` per master plan note. JWT-only. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | Per-tenant branding (logo + color) | PARTIAL | `BuilderBranding` model + `src/app/api/builder/branding/` exist (per-builder). Not per-tenant. |
| AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md | Status page `status.aegis.build` | NOT BUILT | No status page. |
| **AEGIS_GLASS_ROLLOUT_PLAN.md** | Outfit + Azeret Mono + Instrument Serif fonts | NOT BUILT | Spec says swap from Inter; current `layout.tsx` still uses Inter / JetBrains Mono / Playfair (per master plan §2.1). |
| AEGIS_GLASS_ROLLOUT_PLAN.md | `<AegisBackground />` glass + blueprint system | BUILT | `src/components/AegisBackground.tsx` + `BlueprintAnimation.tsx` + `SystemPulse.tsx` + `BOMBlueprintBackground.tsx` + `PortalBackground.tsx` all exist. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | Glass utility classes (`.glass-card`, `.bp-label`, etc.) | PARTIAL | `aegis-v4.css` exists in `src/app/`; coverage of all spec'd utilities unverified. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | 13,825-instance hardcoded color migration | PARTIAL | Started; recent `CONTRAST-FIX-HANDOFF.md` and `_apply-contrast` work in progress. Not done. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | New components: SpotlightProvider, ContextMenu, InlineEdit, DragCompare, SankeyFlow, BlueprintAnnotation, NorthStarMetric, RevisionBadge, RedlineChange, DimensionLine | NOT BUILT | None of these component files exist in `src/components/` or `ui-v2/`. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | North star metric per role in topbar | NOT BUILT | No role-based north-star widget visible. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | Right-click context menus | NOT BUILT | No `ContextMenu.tsx` in components. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | Inline table editing on price/margin | NOT BUILT | No `InlineEdit.tsx`. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | Sankey cash flow diagram | NOT BUILT | No Sankey component. |
| AEGIS_GLASS_ROLLOUT_PLAN.md | Error boundaries on all 31 layouts | PARTIAL | `ErrorBoundary.tsx` + `ErrorFallback.tsx` exist; per-layout coverage unverified. |
| **AEGIS-TEAM-READINESS-PLAN.md** | Seed builders / products / staff / vendors | BUILT | `scripts/run-all-imports.mjs` + `scripts/import-*.mjs` series exist. |
| AEGIS-TEAM-READINESS-PLAN.md | Staff Directory `/ops/team` | NOT BUILT | No `src/app/ops/team/` route. `Staff` model exists. |
| AEGIS-TEAM-READINESS-PLAN.md | Financial Command Center | BUILT | `src/app/ops/command-center/` + `src/app/ops/finance/`. |
| AEGIS-TEAM-READINESS-PLAN.md | Collections Dashboard + cron | BUILT | `src/app/ops/collections/` + 3 collection crons. |
| AEGIS-TEAM-READINESS-PLAN.md | Cron Health page | PARTIAL | `CronRun` model exists; UI presence at `/ops/admin/crons` not at top of ops listing. |
| **Aegis_Architecture_Map.md** | Three-layer naming (Platform/Supplier/Builder) | NOT BUILT | No `app/(platform)/`, `app/(supplier)/`, `app/(builder)/` route groups. Single mixed `src/app/dashboard/` (builder side) + `src/app/ops/` (supplier side). |
| Aegis_Architecture_Map.md | `tenantType` column (SUPPLIER/BUILDER) | NOT BUILT | Schema has no Tenant entity. |
| Aegis_Architecture_Map.md | Aegis Capital subsystem | NOT BUILT | No `app/(capital)/` or `lib/capital/` directory. |
| **Aegis_Autonomous_Build_System.md** | Helm Master Controller | NOT BUILT | Document is blueprint-only. No `helm` CLI, no Temporal/Inngest workflow runner, no `src/lib/helm/`. Lives only as concept. |
| Aegis_Autonomous_Build_System.md | 6 fabrics (Code/Design/Content/Browser/Data/Ops) | NOT BUILT | The 76-agent build fleet is design-doc only. |
| Aegis_Autonomous_Build_System.md | Budget governor + spending card | NOT BUILT | No Ramp/Brex API integration in `src/lib/`. |
| Aegis_Autonomous_Build_System.md | Vector memory (pgvector) | NOT BUILT | No pgvector extension visible. |
| Aegis_Autonomous_Build_System.md | OpenTelemetry / Tempo / Jaeger | NOT BUILT | Sentry only. |
| **Aegis_Agent_Fleet.md** + Reconciliation | Fleet A — 6 Abel Ops agents | BUILT | `agents/{coordinator,sales,marketing,ops,customer-success,intel}/` directories present + `agents/startup.sh`. Live per CLAUDE.md note. |
| Aegis_Agent_Fleet.md | Fleet B — 76-agent build fleet | NOT BUILT | Spec only — not provisioned. |
| **Phase_1_Task_Queue.md** | T--00 password rotation | NOT BUILT | Per spec, `[NEEDS NATE]` — Nate executes manually. Plaintext password may still be in agent CLAUDE.md files. |
| Phase_1_Task_Queue.md | Gate -1: phase-1 branch + branch protection | NOT BUILT | Repo on `main`. No `phase-1` branch in current git status. |
| Phase_1_Task_Queue.md | T--02 Neon `prod-phase-1` branch | NOT BUILT | No evidence in env config. |
| Phase_1_Task_Queue.md | T--03 `MULTI_TENANT_ENABLED` flag | NOT BUILT | Feature flag not present in codebase grep. |
| Phase_1_Task_Queue.md | T--04 Smoke test suite (10 workflows) | NOT BUILT | No `tests/smoke/` directory. |
| Phase_1_Task_Queue.md | T--05 Backup/rollback runbook | NOT BUILT | No `docs/runbooks/cutover-rollback.md`. |
| Phase_1_Task_Queue.md | T--07 `dont-break-abel.yml` CI | NOT BUILT | No such workflow visible at `.github/workflows/`. |
| **Aegis_AI_Maximization.md** + Aegis_AI_Architecture | Full AI agent surface, predictions, NUC bridge | PARTIAL | `src/lib/nuc-bridge.ts` exists; `agent-hub` API tree; `BuilderIntelligence`, `QualityPrediction`, `DemandForecast`, `RevenueForecast`, `CashFlowForecast`, `ProcurementAlert` models. UI surfacing thin. |
| **AEGIS_DESIGN_SYSTEM.md** | Tokens in `src/app/design-tokens.css` | NOT BUILT | File not created — tokens live in `globals.css` and `aegis-v4.css`. |
| AEGIS_DESIGN_SYSTEM.md | OKLCH primitive token layer | PARTIAL | Token system exists; OKLCH-specific structure unverified. |
| **Aegis_Design_and_UX_Excellence.md** | LCP <200ms, INP <100ms targets | NOT BUILT | Lighthouse CI not in place; perf budget enforcement absent. |
| **Aegis_Motion_and_Graphics_System.md** | Three-zone motion budget (Visit/Transition/Work) | PARTIAL | No central enforcement; individual components animate. |
| **AEGIS_V2_CLAUDE_CODE_PROMPT.md** (old) | — | STALE | Predates current architecture. Skip. |
| **AEGIS-DEPLOY-NOTES-2026-04-22.md** | Deploy log artifact | N/A | Historical record, not a plan. |
| **ABEL_MASTER_BUILD_PLAN.md** | (referenced in user prompt) | STALE | Not in workspace listing — superseded by AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md. |

---

## Orphan plans (no shipping code)

These docs describe systems with **zero or near-zero implementation footprint**:

1. **AEGIS_TIER_DRIVEN_BUILD_PLAN.md** — Only `src/lib/builder-tiers.ts` (types) exists. No `Tenant` / `TenantProfile` model, no `useTenantProfile()` hook, no tier-aware middleware, no tier-aware home variants, no `tier-reclassify` cron, no 27-account seed. **The single architectural commitment of v1.0 (2026-04-23) shipped only the type definitions.**
2. **Aegis_Autonomous_Build_System.md (Helm)** — Pure design doc. No `helm` CLI, no Temporal, no fabric routing, no budget governor. The "rocket ship mode" remains aspirational.
3. **Aegis_Architecture_Map.md three-layer separation** — `app/(platform)/`, `app/(supplier)/`, `app/(builder)/` route groups don't exist. Repo is still single-tenant. No `tenantType` discriminator.
4. **AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md Phase 1 multi-tenancy (Modules 1, 22, 23, 24, 25, 26, 30)** — Tenant model, RLS, public `/v1/` API, Stripe Subscriptions, Posthog, developer/marketing site, security portal — **none built**. Phase 0 exit gates §2.6 are not met.
5. **Phase_1_Task_Queue.md Gate -1 safety infra** — phase-1 branch, prod-phase-1 Neon DB, MULTI_TENANT_ENABLED flag, smoke test suite, rollback runbook, "don't break Abel" CI — **none built**. The whole queue is blocked at task zero.
6. **Aegis_Agent_Fleet.md Fleet B (76 agents)** — Build/marketing/sales agents for Aegis SaaS GTM not deployed. Only Fleet A (6 Abel Ops agents) exists.

---

## Orphan code (built but not in any plan)

These shipped modules don't appear in any of the strategic planning docs as committed scope:

1. **Bolt mirror tables** — `BoltCommunity`, `BoltCrew`, `BoltCustomer`, `BoltEmployee`, `BoltFloorplan`, `BoltJob`, `BoltWOType`, `BoltWorkOrder` (8 models). Migration scaffolding from ECI Bolt; not in any current plan, lives between "kill or migrate" purgatory.
2. **BPW mirror tables** — `BpwCheck`, `BpwCommunity`, `BpwFieldPO`, `BpwInvoice`, `BpwJobDetail` (5 models). Pulte/Brookfield ETL holding tank. Plans don't specify this as a long-term entity.
3. **BWP mirror tables** — `BwpBackcharge`, `BwpCheck`, `BwpContact`, `BwpFieldPO`, `BwpFieldPOLine`, `BwpInvoice` (6 models). Same pattern, more Brookfield-specific.
4. **`/ops/aegis-brain-sync`, `/api/cron/brain-sync*`** — NUC brain feed integration. Real, working, but not described in any plan doc.
5. **`Door`, `DoorEvent`, `DoorIdentity`, `ExplodedDoor.tsx`** — door-config visualization system; brand-rich but not on any module roadmap.
6. **`AgentConversation`, `AgentEmailLog`, `AgentMessage`, `AgentSession`, `AgentSmsLog`, `AgentTask`** — Fleet A agent runtime data tables. Plan docs reference 6 Abel agents but don't spec these specific persistence models.
7. **`MarketingCampaign`, `CampaignRecipient`, `SEOContent`, `SEOKeyword`, `Prospect`, `PermitLead`** — sales/marketing automation surface. Mentioned at most as Marketing Agent capability, not as data-model commitments.
8. **`Trade`, `TradeReview`** — subcontractor/trade entity, despite gap-analysis listing "Subcontractor management" as NOT BUILT. Partial scaffold without a plan reference.
9. **22 BPW + 8 Bolt + 6 BWP + Hyphen/Pulte ETL models** — total ~40 models exist as integration/import scaffolding, none of which are committed as long-term schema in the master plan.

---

## Stale plans that should be deleted (or moved to `docs/_archive/`)

1. **AEGIS_V2_CLAUDE_CODE_PROMPT.md** — pre-rename old prompt; contradicts current architecture.
2. **ABEL_MASTER_BUILD_PLAN.md** — superseded by `AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md`.
3. **VISUAL-IMPROVEMENT-PLAN.md** (workspace root) — overlaps `AEGIS_GLASS_ROLLOUT_PLAN.md`; pick one.
4. **`Abel_Builder_Platform_Phase_1_PRD.md`** + any sibling `Abel_Builder_Platform_*` Tier-3 doc — repo CLAUDE.md flags these as STALE.
5. **AEGIS-DEPLOY-NOTES-2026-04-22.md** — historical artifact; move to `docs/changelog/`.
6. **GO-LIVE-READINESS-2026-04-22.md** + sibling go-live runbooks — past-tense; archive to `docs/_archive/2026-04-go-live/`.

---

## Cross-cutting findings

1. **Branch reality vs. plan reality**: Repo CLAUDE.md says "All Phase 1 work happens on `phase-1` branch only." Current branch is `main`. There is no `phase-1` branch. Either the rule has been silently abandoned, or every plan-doc activity since 2026-04-23 is in violation. **This needs to be reconciled before any tier work merges.**
2. **Multi-tenancy is the canonical missing primitive.** Six different planning docs (`AEGIS_BUILDER_PORTAL_MASTER_BUILD_PLAN.md`, `AEGIS_TIER_DRIVEN_BUILD_PLAN.md`, `AEGIS_BUILDER_PORTAL_LIVE_SPRINT.md`, `Aegis_Architecture_Map.md`, `Phase_1_Task_Queue.md`, `Aegis_Agent_Fleet_Reconciliation.md`) hinge on a `Tenant` table that does not exist. Until this lands, all of those docs are theoretical.
3. **Schema is bloated.** 200+ Prisma models. Plan docs reference ~58–80. ~40 of these are integration/import mirror tables for legacy systems. A schema-cleanup audit would shrink the cognitive surface materially.
4. **No test infrastructure.** No `tests/` directory at repo root. RLS test suite, smoke test suite, and contract tests called for in three plan docs are all absent.
5. **Public API + marketing site = $0 of code.** Modules 22, 25, 26 (the GTM-facing surface) don't exist. `aegis.build` not deployed.
6. **Aegis Capital absent.** Document references it in 3+ places; no code.

---

## Recommendation: doc-set normalization

Move to `docs/_archive/`: 6 docs above (stale).
Move to `docs/active-plans/`: the 11 docs that are still operative.
Add a `docs/PLANS-INDEX.md` with status ribbons (ACTIVE / PAUSED / DONE / ARCHIVED) so anyone arriving cold knows what's load-bearing.
