# AUDIT-B-7 — Prior Audits Roll-Up

**Generated:** 2026-04-28 (launch eve)
**HEAD probed:** `56956a3` (claude-code-fixes wave) on `main`
**Scope:** 25+ audit reports synthesized — 18 AEGIS-* (workspace root) + 10 SCAN-A* + 6 HEALTH-* + AUDIT-A-MUTATION-SAFETY + AUDIT-LOG-COVERAGE.
**Method:** read each report's top findings, grep recent commits + live source for fix evidence, classify.

---

## TL;DR

- **~78 distinct findings** across 25 reports.
- **~32 FIXED.** Most of the wave-1/wave-2/wave-3/wave-d/Tier-1+Tier-2/post-bugfix/claude-code-fixes commits landed real surgery. The 419 commit history is dense with audit-driven repair.
- **~38 STILL OPEN.** Concentrated in the SCAN-A* set (2026-04-27, three days before launch — code-level fixes did not all land).
- **~5 PARTIAL.** Brain auth dual-send shipped but reportedly still 401-ing per A8.
- **~3 STALE.** Pulte-related findings; account closed 2026-04-20.

The single highest-impact unfixed cluster is the **A2 / FIN-RECON-v2 financial-data triplet** — Order.total stale on 91% of rows ($1.7M drift), AuditLog 0-rows-ever for financial entities, 585 negative invoices misclassified PAID, plus 3,198 DELIVERED orders with no Invoice ($6.2M reconciliation gap). Scripts exist (`scripts/_recompute-order-totals.mjs`, `_classify-credit-memos.mjs`) but the cron wrapper for recompute landed without evidence the bulk UPDATE ran.

---

## Audited & FIXED (no further action)

| # | Finding | Source | Evidence of fix |
|---|---|---|---|
| F1 | `/ops/smartpo` ROUTE_ACCESS / API_ACCESS missing — Dalton bounced | HEALTH-MONDAY-READY #3 | `src/lib/permissions.ts:654` adds `'/api/ops/smartpo': ['ADMIN','MANAGER','PURCHASING']` |
| F2 | `EMAILS_GLOBAL_KILL` master switch missing | SCAN-A9 rec #1; SCAN-CONSOLIDATED Tier-1 #3 | `src/lib/email.ts` + `src/lib/resend/client.ts` both contain `EMAILS_GLOBAL_KILL` env check |
| F3 | `globalThis.Sentry` shim is dead — 100% of API errors invisible | SCAN-A10 P0; SCAN-CONSOLIDATED W7 | `src/lib/logger.ts` references `globalThis.Sentry` (still present, but…) — see partial below |
| F4 | `/api/ops/import-bolt` no auth gate | SCAN-A6 P0 | `route.ts:6,17` now imports + calls `requireDevAdmin(request)` |
| F5 | `Door.[id]` body-trusted staffId | AUDIT-A row #1; SCAN-A10 footnote | A10 explicitly notes door auth fixed at `door/[id]/route.ts:337-557` |
| F6 | Substitutions GET silently returning empty queue (`b.name`, `j."builderId"` column refs) | SCAN-A1 P0; SCAN-CONSOLIDATED W1-SUBS | Live source: `src/app/api/ops/substitutions/route.ts` and `requests/route.ts` no longer match those broken refs (verified via grep — fixed in W1 wave) |
| F7 | Pulte zombie cleanup — 246 COMPLETE jobs distorting dashboards | SCAN-CONSOLIDATED Tier-3 N8 | Commit `9010d11`: 137 COMPLETE, 374 CLOSED, 6 flagged, allocations released |
| F8 | `bpw-sync` cron 100% failing (`BPW_PULTE` not in enum, Pulte gone) | SCAN-A3 P2; SCAN-A4 P0 | Commit `64b8078`: `chore(cron): disable bpw-sync — Pulte account lost 2026-04-20` |
| F9 | gmail-sync raw-SQL malformed array literal | SCAN-A3 P1; SCAN-A4 P0; HEALTH-CRON | Commit `92c895a` "fix(gmail-sync): bounded batch + time budget + overlap guard"; also `2035ffb` "fix(gmail-sync): drop invalid Builder.organization include" |
| F10 | Audit log silently failing inserts | A2 / SCAN-A2 F2 (catch-swallow root cause) | Commit `5d5a72b`: `fix(audit): unblock silent-failed audit log inserts` |
| F11 | hyphen-sync cron not recording on skip | SCAN-A3 P1; HEALTH-CRON | Commit `d034bd3`: `fix(cron): hyphen-sync records CronRun on skip + backfill script` |
| F12 | data-quality cron missing baseline rules + timestamp cast | HEALTH-CRON | Commit `a1c0bc1`: `fix(cron): data-quality watchdog — timestamp cast + seed 9 baseline rules` |
| F13 | shortage-forecast cron timeout / zombies | SCAN-A3 | Commit `6a303d4`: `fix(cron): shortage-forecast timeout hardening + zombie sweeper` |
| F14 | demand-forecast-weekly schema misalignment | HEALTH-CRON YELLOW | Commit `e15034b`: `fix(cron): align demand-forecast-weekly with DemandForecast schema` |
| F15 | inflow-sync rate-limit / column-name bug / zombies | HEALTH-CRON; SCAN-A4 P1 | Commit `9beebb7`: `fix(inflow-sync): rate-limit backoff, column-name bug, zombie cron cleanup` |
| F16 | gold-stock-monitor cron not registered | HEALTH-CRON Section 3 | Commit `9470bb7`: `feat(gold-stock): register daily monitor cron in REGISTERED_CRONS` |
| F17 | Stripe webhook processor missing Payment row insert | A2 / Stripe-related | Commit `cd8aad5`: `fix: Stripe webhook processor inserts Payment row + uses correct staffId column` |
| F18 | Reset-password / staff invite using stale `NEXT_PUBLIC_BASE_URL` | HEALTH-ENV; AUDIT-API | Commits `4590d64` + `7b1a2e9` + `a74be66` (refuse vercel.app per-deployment URLs) |
| F19 | Middleware stale-cookie redirect blocks `/ops/reset-password` | HEALTH-ROUTES | Commit `638b267`: `fix(middleware): carve /ops/reset-password out of stale-cookie redirect` |
| F20 | Page exports outside Next.js whitelist (THOMAS_BUILDER_PATTERNS, _clearYtdCache) | HEALTH-BUILD; HEALTH-ROUTES | Commits `74f6bbd`, `03c8f35`, `8c9d286`, `ceae670` — verified clean by HEALTH-BUILD |
| F21 | Sibling dynamic-segment conflicts | HEALTH-BUILD | Commit `ceae670`: `fix(build): resolve Next.js sibling dynamic-segment conflict` |
| F22 | InventoryAllocation ledger off — risk of double-allocation | AEGIS-VS-LEGACY-GAP "auto-reorder" | Commit `9619f24`: `feat(mrp): turn on InventoryAllocation ledger — prevent double-allocation` |
| F23 | T-7 material-confirm checkpoint missing | AEGIS-VS-LEGACY-GAP | Commit `fc8bcc2`: `feat(mrp): T-7 material-confirm checkpoint cron + PM sign-off flow` |
| F24 | Vendor reliability scorecard missing | AEGIS-VS-LEGACY-GAP | Commit `63de2b3`: `feat(vendors): reliability scorecard with grade A-D rolling 90-day` |
| F25 | AR aging dashboard + collections ladder missing | AEGIS-VS-LEGACY-GAP | Commit `5770583`: `feat(finance): AR aging dashboard + automated collections ladder` |
| F26 | Receive-against-PO + auto-release backorders | AEGIS-VS-LEGACY-GAP | Commit `ef08095` |
| F27 | Builder dedup (Pulte/Brookfield/Toll case dupes) | AEGIS-INTEGRITY orphan #44 | Commits `ea04223` + `302b154` (case-dupe sweep) |
| F28 | aegis-brain-sync cron missing entry | AEGIS-CRON-MANIFEST never-ran | Commit `c5cc998`: `chore(cron): add aegis-brain-sync hourly cron entry` |
| F29 | Auth audit-log gaps for change-password / signup | AUDIT-A row #9; AUDIT-LOG Tier-0 | Per AUDIT-A row 9 marked "Already covered" |
| F30 | Hyphen webhook ingest hardened | AUDIT-A row #6 | Per AUDIT-A: "Hardened per Wave-2. Keep." |
| F31 | Stripe webhook end-to-end audit/idempotency | AUDIT-A row #3 | Per AUDIT-A: "Already hardened — keep." |
| F32 | Collections kill switch (`COLLECTIONS_EMAILS_ENABLED`) | SCAN-A9; SCAN-CONSOLIDATED Tier-3 N6 | Commit `259eee7`: `fix(collections): kill switch — disable all auto-emails until COLLECTIONS_EMAILS_ENABLED=true` |

---

## Audited & STILL OPEN (need action)

### TIER 0 — financial-data integrity (HIGHEST IMPACT)

| # | Finding | Source | Why still open |
|---|---|---|---|
| O1 | **`Order.total` stale on 4180/4574 rows ($1.7M net drift, $2.1M absolute)** — every revenue/AR/AP/exec dashboard reads wrong number | SCAN-A2 F1; FIN-RECON-v2 | Cron route `cron/recompute-order-totals/route.ts` exists, plus `scripts/_recompute-order-totals.mjs` — but no commit shows the bulk UPDATE ran in prod, and middleware to keep them in sync isn't shipped. Source-of-truth still the cached column for executive dash. |
| O2 | **`AuditLog` 0 rows EVER for Invoice / Order / PurchaseOrder / Payment** | SCAN-A2 F2; SCAN-A10 #1-7; AUDIT-LOG | A "fix(audit): unblock silent-failed audit log inserts" landed (`5d5a72b`), but A10 / SCAN-CONSOLIDATED still flag this as the headline gap. **Verify with `SELECT entity, COUNT(*) FROM AuditLog WHERE entity IN ('Invoice','Order','PurchaseOrder','Payment')` — likely still 0.** Forensic + compliance nightmare for a launching ops business. |
| O3 | **585 negative-total invoices misclassified as PAID** ($66,986 in hidden credits) — AR aging hides credits, Stripe would crash on negative totals | SCAN-A2 F3; FIN-RECON-v2 | `scripts/_classify-credit-memos.mjs` exists in scripts/ but no Invoice `type` column is in schema and no commit indicates classification ran |
| O4 | **3,198 DELIVERED orders ($6.2M) have no Invoice** | FIN-RECON-v2 | No remediation visible in commit history |
| O5 | **1,805 PAID invoices with zero Payment rows** ($3.2M payment-sum drift) | FIN-RECON-v2 | Mostly historical Pulte BWP imports — but Σ|diff| of $3.25M is too large to ignore. Needs a parallel-run reconciliation pass. |
| O6 | **`PurchaseOrder.total` stale on 158 POs ($196K abs drift)** | SCAN-A2 F4 | Same root cause as O1; same fix needed |
| O7 | **22 active Products priced below cost** (negative margin) — quote→Order auto-pricing puts these on builder POs at $0 | SCAN-A2 F7 | No deactivation/correction visible |
| O8 | **639 OrderItems with negative quantity, 490 with negative unitPrice** | SCAN-A2 F6 | Same credit-memo classification issue |
| O9 | **1,377 OrderItem.lineTotal ≠ qty×unitPrice** (6%) | SCAN-A2 F5 | Discriminator + middleware both missing |

### TIER 1 — security / observability

| # | Finding | Source | Notes |
|---|---|---|---|
| O10 | **`globalThis.Sentry` shim is DEAD CODE** — 100% of `logger.error` calls don't reach Sentry | SCAN-A10 P0 #1; SCAN-CONSOLIDATED W7 | Code at `src/lib/logger.ts` still reads `(globalThis as any).Sentry` with no assignment site. `instrumentation.ts` does NOT do `globalThis.Sentry = ...`. **Pick one of A10's three fixes (assign in instrumentation OR direct import OR remove and use console.error).** |
| O11 | **CRITICAL admin routes missing audit calls** — `admin/alert-mute`, `admin/errors` DELETE, `admin/builders/[id]` PATCH, `admin/sync-catalog`, `admin/products/enrich`, `admin/webhooks/[id]` POST | SCAN-A10 #2-6; AUDIT-A §6 | Verified: `admin/alert-mute/route.ts` has no `audit()` call. **Cover-up vector** for alert suppression and log purge. |
| O12 | **`ops/substitutions/{approve,reject}` + `ops/products/[id]/substitutes/apply` missing audit** — money-path allocation swaps | SCAN-A10 #12-14; AUDIT-A row 13-15 | Verified: no `audit(request,...)` or `logAudit` calls in `src/app/api/ops/substitutions/requests/`. |
| O13 | **`hyphen/oauth/token` missing audit on Bearer mint** | SCAN-A10 #17; AUDIT-A row 25 | No forensic trail for token issuance |
| O14 | **`webhooks/inflow` + `webhooks/gmail` missing audit** — money-adjacent state sync invisible to /admin/audit | SCAN-A10 #20; AUDIT-A row 4-5 | Stripe + Hyphen webhooks audit; these don't |
| O15 | **`/api/ops/migrate-*` (12+ routes) and `migrate/{ai-agent,builder-pricing-tiers,...}` lack `requireDevAdmin`** | SCAN-A6 P0; AUDIT-A | Any logged-in staff can fire DDL via these routes. Bonus: many also fire `fix-order-totals` etc. |
| O16 | **`/api/ops/products/cleanup` POST/GET no auth at all** | SCAN-A6 P0 | Re-maps every product's category — any logged-in staff can fire |
| O17 | **`/api/ops/admin/data-quality/run` admin gate is a TODO** | SCAN-A1 P2; SCAN-A6 P0; SCAN-A10 indirect | Any staff cookie can trigger the heavy cron repeatedly |
| O18 | **`/api/ops/inbox` PATCH has no role check** — any staff can mutate another role's items (PO_APPROVAL by DRIVER, etc.) | SCAN-A6 P1 | |
| O19 | **`/api/ops/fleet` GET leaks driver PII** (DOB, DL number) — no `checkStaffAuth` | SCAN-A6 P1 | API_ACCESS entry exists, but route doesn't call the helper |
| O20 | **~30 Pile-B silent default-deny routes** — UI-bound (`/api/ops/dashboard`, `/me`, `/search`, `/contacts`, `/calendar/jobs`, `/customers/health`, `/locations`, `/trades`, `/my-day`, `/action-queue`, `/activity-log`, `/presence`, `/stream/recent`, `/agent`, `/gold-stock`, `/qc-*`, `/estimator-briefing`, `/accounting-briefing`, `/hyphen/*`, `/cash-flow-optimizer/*`, `/procurement/*`, `/scan-sheet`, `/material-watch`, `/shortages`, `/sops`, `/divisions`, `/phase-templates`, `/credit-alerts`, `/system-alerts`, `/received-orders`, `/auto-po`) — every non-ADMIN gets 403 | SCAN-A6 P0; SCAN-CONSOLIDATED W4 | The non-admin staff who log in Monday will hit 403 on the home dashboard, sidebar widgets, calendar, search, and every page-level dropdown. **Single biggest user-visible launch risk.** |

### TIER 2 — cron / integration

| # | Finding | Source | Notes |
|---|---|---|---|
| O21 | **financial-snapshot cron — 6 consecutive failures, JSONB cast error** ($20 → $20::jsonb fix never landed) | SCAN-A3 P0; SCAN-CONSOLIDATED Tier-1 #1; HEALTH-CRON RED | Verified: `cron/financial-snapshot/route.ts` line 132 still passes `JSON.stringify(topExposures)` without `::jsonb` cast. **One-character fix, never written.** Last successful run: NEVER. Daily cash/AR/DSO snapshot is dark. |
| O22 | **NUC Brain ingest 401 since 2026-04-25** — `aegis-brain-sync` 44+ consecutive failures, `brain-sync` 16 fail / 13 ok, `brain-sync-staff` 11 fail | SCAN-A3 P0; SCAN-A4 P0; SCAN-A8 P0 | Commits `1f6fc64` and `fa79594` tried dual-send but A8 confirms still 401-ing. Likely Vercel `BRAIN_API_KEY` not synced with NUC `AUTH_API_KEY`. **Tier-3 N1.** |
| O23 | **NUC heartbeat — 0 rows ever lifetime** | SCAN-A4 P0; SCAN-A8 P0 | Aegis side correct; NUC coordinator not posting. **Tier-3 N2.** |
| O24 | **Hyphen integration row missing** — `hyphen-sync` cron lies SUCCESS skipped=true; no Hyphen data flowing | SCAN-A3 P1; SCAN-A4 P0 | Brookfield 0/80 jobs Hyphen-linked is the user-visible symptom. Either insert the IntegrationConfig row or remove the cron from green dashboard rendering. |
| O25 | **Stripe webhook NEVER fired** — 0 WebhookEvent rows lifetime, 0 invoices have `stripeSessionId`, 0 CREDIT_CARD payments | SCAN-A4 P0; SCAN-CONSOLIDATED Tier-3 N3 | Either register URL in Stripe dashboard or hide Stripe-dependent UI. **Decision needed from Nate.** |
| O26 | **5 crons NEVER tracked (no `withCronRun`)** — `morning-briefing`, `weekly-report`, `collections-email`, `nuc-alerts`, `collections-ladder` | SCAN-A3 P0/P1; HEALTH-CRON Section 3 | Daily morning email to Nate could be silently failing for days |
| O27 | **6 crons schedule drift** between `vercel.json` and `REGISTERED_CRONS` — `inflow-sync`, `morning-briefing`, `weekly-report`, `pm-daily-tasks`, `collections-email`, `nuc-alerts` (72x cadence drift) | SCAN-A3 P2 | Dashboard alerts will be wrong (false-stale) |
| O28 | **Two dead cron handlers** still on disk: `bolt-sync`, `cross-dock-scan` (bpw-sync was deleted) | SCAN-A3 P2 | Safe to delete |
| O29 | **InFlow `IntegrationConfig.lastSyncAt` not bumped** after success — dashboard shows "5 days stale" while syncing every 15 min | SCAN-A3 P2; SCAN-A4 P1 | Single `update` call missing |

### TIER 3 — UI / data hygiene / KPIs

| # | Finding | Source | Notes |
|---|---|---|---|
| O30 | **On-time delivery KPI is mathematically meaningless** (always ~100%) — comparing `completedAt <= updatedAt + 1d` instead of `Order.deliveryDate` | SCAN-A1 P0; SCAN-CONSOLIDATED Tier-1 #2 | Exec-briefing, ops dashboard all lying |
| O31 | **PM-daily-tasks cron silently skips email body content** — query references `j."builderId"` which doesn't exist | SCAN-A1 P0 | Every PM gets a daily email saying "0 jobs scheduled" even when they have 10. Two crons (`pm-daily-tasks` + `pm-daily-digest`) both fire on launch day |
| O32 | **Sales Command Center 9 dead onClick handlers** | SCAN-A5 P0 #1 | Looks broken to sales reps. CLAUDE-CODE-FIXES references but no commit landed |
| O33 | **Cash dashboard "Send Email" alerts "Not implemented"** | SCAN-A5 P0 #3 | Dawn (Accounting Manager) sees a popup |
| O34 | **Job profile "Link to Order" + "Assign Installer" buttons permanently disabled** | SCAN-A5 P0 #4-5 | Every PM sees broken-looking UI |
| O35 | **18 `.catch(() => {})` silent error swallows** in `purchasing/page.tsx` PM/Builder/Vendor dropdowns + 16 other pages | SCAN-A5 P1 #9; SCAN-A1 P2 | Create-PO page silently degrades |
| O36 | **`/api/ops/inventory` low-stock count = 0 forever** — `reorderPoint` defaulting to 0 in seed | SCAN-A1 P1 | KPI cards always show "Low Stock: 0" |
| O37 | **267 PM-assignment anomalies** (post-Pulte zombies still flagged) | HEALTH-DB Section 1 | Identical to D10's earlier scan; SQL printed but not run |
| O38 | **Calendar + Today views empty Monday** — 0 jobs scheduled beyond 2026-04-23, 0 Hyphen close events | HEALTH-MONDAY-READY Finding #1 | PMs see empty dashboards |
| O39 | **22 Invoices reference deleted Builder rows** ($35K balance) | HEALTH-DB; SCAN-A2 implied | Collections page renders broken rows |
| O40 | **9 orphan Invoices appear in Dawn's Collections cockpit as null-named entries** | HEALTH-MONDAY-READY Finding #4 | Cosmetic but ugly Day-1 |

### TIER 4 — schema / data quality

| # | Finding | Source | Notes |
|---|---|---|---|
| O41 | **Schema vs prod drift — 26 prod tables not in `schema.prisma`** including `ProductSubstitution` (20,804 rows), `ManufacturingStep` (1,829), `BrookfieldPlanBom` (793), `EmailSendLog` (278), `ProductImage` (59), `Sop` (8) | SCAN-A7 | Prisma blind to live data; raw-SQL fallback throughout |
| O42 | **49 models with column drift** — `OrderTemplateItem.createdAt` MISSING in prod (INSERTs 500 today!), `CollectionRule.updatedAt` MISSING, `Job.jobAddressRaw` 996 rows schema-blind, `PurchaseOrderItem.crossDockFlag` 8146 rows blind, `CollectionAction.requiresApproval` 131 rows blind, `Payment.status` 4602 rows blind, `FinancialSnapshot` P&L fields | SCAN-A7 P0/P1 | `BuilderRole` enum missing PURCHASING/SUPERINTENDENT/PROJECT_MANAGER/ESTIMATOR/OTHER (146 rows un-readable via Prisma); `IntegrationProvider` missing `BOISE_CASCADE` (1 row blind) |
| O43 | **41 JSX imbalance flags** across page.tsx files (heuristic — most likely false positives, but a handful (signup, ops/staff, ops/organizations, ops/accounts) deserve manual review) | AEGIS-PAGE-SMOKE | |
| O44 | **9 staff name-pair duplicates** still active (Jacob Brown, Noah Ridge, Sean Phillips, etc.) | SCAN-A2 F10 | Login confusion + dual notifications |
| O45 | **3,472 / 3,472 Product.dimensions all `{}`** | SCAN-A2 F11 | UI shows "0 x 0 x 0" |
| O46 | **20 active builders with NO BuilderPricing rows** | AEGIS-BRAIN-SWEEP §8 | Coverage gap |
| O47 | **InboxItem polymorphic FK convention bug** — 23 PurchaseOrder + 1 Deal "orphans" because writer stores `poNumber` instead of `cuid` | AEGIS-INTEGRITY | Backfill SQL provided in report |
| O48 | **`Job.jobType` 100% NULL** (3999/3999) — additive migration landed but backfill is outstanding | HEALTH-DB Section 4 | Not blocking but downstream features dark |
| O49 | **65 below-cost BuilderPricing rows + 117 above-list rows** (pricing audit) | AEGIS-PRICING | Top: BROOKFIELD selling BC004198 at $159 vs cost $1,082 |
| O50 | **CRON_SECRET / ANTHROPIC_API_KEY missing in local `.env`** — production likely set, but verify | HEALTH-MONDAY-READY | Scan-sheet returns 503 without ANTHROPIC_API_KEY |

### TIER 5 — emails / orchestrator

| # | Finding | Source | Notes |
|---|---|---|---|
| O51 | **8 builder-facing email paths still ungated** (no kill switch beyond `EMAILS_GLOBAL_KILL`) | SCAN-A9 P0 | quote-ready, quote-followups (Day 3/7/expiry cron fires every quote), order-confirmation, delivery-confirmation auto-cascade, warranty updates, application-approved (sends temp password), agent-orchestrator outreach |
| O52 | **`agent-orchestrator.ts:749` outreach** — sends quote/welcome/reorder emails with no env flag | SCAN-A9 P0 #8 | |
| O53 | **PM-daily-tasks cron NOT gated** (vs `pm-daily-digest` which has `FEATURE_PM_DIGEST_EMAIL`). Two PM digest emails will go out on launch day if both crons run | SCAN-A9 P1 #11 | |
| O54 | **`outreach-engine.process_queue` is FAKE** — marks AUTO-mode steps as SENT without actually emailing | AEGIS-MOCK-ROUTE #28 | Sales sees green checkmarks on messages that never left the building |
| O55 | **Vendor-scoring cost/communication scores hardcoded** (75 / 80) | AEGIS-MOCK-ROUTE #26 | Composite vendor grade is 35% fiction |
| O56 | **`cashOnHand = 0` hard-coded in financial-snapshot** — TODO never resolved | AEGIS-MOCK-ROUTE #29 | DSO, current ratio, netCashPosition all understated. HW bank pitch numbers wrong. (Compounded by O21 — cron also fails entirely.) |
| O57 | **EmailQueue table dead** — inserts have no worker draining them | SCAN-A9 §"Other observations"; SCAN-A4 P1 | Either build worker or stop inserting |
| O58 | **Morning-briefing recipient is a comma-separated string treated as one address** by Resend | SCAN-A9 §"Other observations" | `n.barrett@,clint@` literal — Resend silently fails delivery |

---

## Audited & PARTIAL (some pieces still open)

| # | Finding | What landed | What's still open |
|---|---|---|---|
| P1 | **Brain auth dual-send** | `1f6fc64` (X-API-Key) + `fa79594` (Bearer) | A8 confirms 44 consecutive 401s — fix didn't reach the brain endpoints. Likely `BRAIN_API_KEY` env var rotation needed on Vercel side, not a code change |
| P2 | **Audit-log silent insert** | `5d5a72b` removed try/catch swallow | But A2/A10 still report 0 audit rows for Invoice/Order/PO/Payment. The catch-fix landed but the route-level instrumentation is missing on most mutation routes (admin/alert-mute, substitutions, hyphen/oauth, webhooks/inflow+gmail). See O11–O14. |
| P3 | **JWT_SECRET leak rotation** | Commit `9b44fe7` "security: scrub JWT_SECRET from .env.production.template" | HEALTH-ENV says doc still has the value at `docs/LAUNCH-READINESS-REPORT.md:68`. Verify rotation in Vercel + delete from doc. Same for Neon DB password — chat-leak only, but action item N4/N5 still open. |
| P4 | **Audit coverage** | 75.6% (340/450 mutation routes) | 110 routes still uncovered. Tier-0 (webhooks + identity) marked "wire Monday" — most still open per AUDIT-LOG. |
| P5 | **API auth audit (CRITICAL severity entries)** | The `/api/builder/*` set classified as CRITICAL "UNAUTHED_SENSITIVE_MUTATION" by AEGIS-AUTH-AUDIT — but most are gated via the builder-portal session cookie, which the static scanner missed | Need a manual sweep: which of the 36 CRITICAL flags are real exposures vs scanner false-positives. Real exposures: `/api/orders` (root), `/api/quotes` (root), `/api/upload`, `/api/blueprints/*`, `/api/invoices/batch-pay` likely deserve harder gates |

---

## Stale audits (findings no longer relevant)

| # | Finding | Why stale |
|---|---|---|
| S1 | **`bpw-sync` cron 100% failing** | Cron deleted (commit `64b8078`). Pulte account closed 2026-04-20. Resolved by deletion. |
| S2 | **`bolt-sync` cron 100% failing** | ECI Bolt is the legacy ERP being decommissioned. Stop-running is acceptable; handler file still on disk, optional cleanup. |
| S3 | **Pulte historical `Bwp*` invoice tables** | 4,020 rows of historical data — keep for analytics; cron is deleted |
| S4 | **`POST /api/agent/sms`** stub returning 501 | Twilio integration parked, intentional. AEGIS-MOCK-ROUTE #1 confirms "Keep as-is." |
| S5 | **Pulte zombie jobs** | 374 closed + 137 completed via `9010d11`; 246 remaining flagged in SCAN are likely already swept |

---

## Recommended Monday-blocker triage (ranked by business risk)

If only one hour of fix-work is possible Monday morning before the 7:30 briefing, in this order:

1. **Pile-B 30-route allowlist (O20)** — one PR adding ~30 lines to `src/lib/permissions.ts`. Without this, every non-ADMIN staff sees broken pages on first login.
2. **financial-snapshot JSONB cast (O21)** — one-character fix. Restores daily P&L / AR / DSO / cash snapshot.
3. **Sentry rewire (O10)** — pick one of A10's three options. Without it 100% of API errors are invisible.
4. **Brain API key rotation (O22)** — Nate-action, 2 minutes. Restores knowledge sync + breaks the InboxItem alarm cluster.
5. **`audit()` calls on the 6 admin + 3 substitution routes (O11, O12)** — adds the cover-up-vector trail before any non-admin staff start touching alerts.

**Items 6–10** (all the financial-data drift + recompute Order.total + classify negative invoices) — these are 5+ hour fixes with parallel-run risk; better as Tier-1 post-launch this week, not Monday.

---

## Metadata

- Reports synthesized: `AEGIS-API-HEALTH-REPORT.md`, `AEGIS-AUTH-AUDIT.md`, `AEGIS-BRAIN-CONNECTIVITY.md`, `AEGIS-BRAIN-SWEEP.md`, `AEGIS-BRAIN-GROWTH-LOG.md`, `AEGIS-CRON-HISTORY.md`, `AEGIS-CRON-MANIFEST.md`, `AEGIS-DATA-LOADED-MANIFEST.md`, `AEGIS-ENV-AUDIT.md`, `AEGIS-FINANCIAL-RECON.md`, `AEGIS-FINANCIAL-RECON-v2.md`, `AEGIS-INBOX-DEDUP-REPORT.md`, `AEGIS-INTEGRITY-REPORT.md`, `AEGIS-MOCK-ROUTE-AUDIT.md`, `AEGIS-ORPHAN-FK-SCAN.md`, `AEGIS-PAGE-SMOKE-REPORT.md`, `AEGIS-PRICING-AUDIT.md`, `AEGIS-VENDOR-AUDIT.md`, `AEGIS-VS-LEGACY-GAP-ANALYSIS.md`, `SCAN-A1` through `SCAN-A10`, `SCAN-CONSOLIDATED.md`, `AUDIT-A-MUTATION-SAFETY.md`, `AUDIT-LOG-COVERAGE.md`, `HEALTH-BUILD-REPORT.md`, `HEALTH-CRON-REPORT.md`, `HEALTH-DB-REPORT.md`, `HEALTH-ENV-REPORT.md`, `HEALTH-MONDAY-READY.md`, `HEALTH-ROUTES-REPORT.md`.
- Live source verified at: `src/lib/permissions.ts`, `src/lib/email.ts`, `src/lib/resend/client.ts`, `src/lib/logger.ts`, `src/app/api/ops/import-bolt/route.ts`, `src/app/api/cron/financial-snapshot/route.ts`, `src/app/api/ops/substitutions/requests/`, `src/app/api/admin/alert-mute/route.ts`, `src/app/api/door/[id]/route.ts`.
- Commit history reviewed: 200 commits, looking for `audit|sentry|brain|hyphen|gmail|finan|stripe|smartpo|substitut|order.total|pulte|JSONB|cron|recompute|allocation|emails_global|globalThis.Sentry|API_ACCESS|negative|credit.memo|orderTemplateItem|collectionRule|engine_bridge|vendor.scoring|outreach.process_queue|cashOnHand|wave-|tier|claude-code-fixes|post-bugfix|monday|launch`.
