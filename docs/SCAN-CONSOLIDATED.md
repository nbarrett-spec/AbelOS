# System Scan — Consolidated Action Plan

**Date:** 2026-04-27
**HEAD at scan:** `171a6b4`
**Scope:** 10 parallel read-only audit agents across API runtime, data integrity, cron health, integrations, frontend, permissions, schema drift, NUC/Brain, email gates, observability.
**Reports:** `docs/SCAN-A1` through `docs/SCAN-A10`.

---

## TL;DR — the 5 things that matter most

1. **`Order.total` is stale on 91% of orders ($1.7M net drift).** Every revenue/YTD/AR/AP number on the executive dashboard is a lie. (A2)
2. **`AuditLog` has 0 rows EVER for financial entities** — Invoice / Order / PO / Payment have no compliance trail. 6 routes call `audit()` but persistence is silently failing. (A2, A10)
3. **Sentry is dead code** — `globalThis.Sentry` is read but never assigned. Zero API alerting. (A10)
4. **Brain ingest has been 401-ing for 8+ hours.** `BRAIN_API_KEY` rotated on NUC, not on Vercel. (A4, A8)
5. **Stripe webhook has NEVER fired.** 0 `WebhookEvent` rows lifetime, 0 invoices have `stripeSessionId`, 0 payments are `CREDIT_CARD`. Either webhook URL not registered in Stripe, or `STRIPE_WEBHOOK_SECRET` wrong. (A4)

---

## Tier 1 — One-line surgical fixes (under 30 minutes total)

| # | Fix | File | Change |
|---|---|---|---|
| 1 | financial-snapshot JSONB cast | `src/app/api/cron/financial-snapshot/route.ts:128` | `$20` → `$20::jsonb` |
| 2 | KPIs on-time rate (currently always-100% fake) | `src/app/api/ops/kpis/route.ts:64` | Replace `completedAt <= updatedAt + 1d` with `<= scheduledDate` |
| 3 | Missing `EMAILS_GLOBAL_KILL` master switch | `src/lib/email.ts:60` + `src/lib/resend/client.ts:185` | Add 3-line guard at top of both `sendEmail` |

---

## Tier 2 — Fix waves (parallel agents, file-isolated)

### W1 — Data drift cleanup (4 agents)

| Agent | Scope | Issue | Severity |
|---|---|---|---|
| W1-ORDER-TOTAL | `src/app/api/cron/recompute-order-totals/route.ts` (NEW) | 91% of `Order.total` stale → $1.7M drift. Cron + UPDATE script that recomputes from `OrderItem` rows. (A2-F1) | P0 |
| W1-AUDIT-PERSIST | `src/lib/audit.ts` | 0 AuditLog rows ever for financial entities — `audit()` swallows persistence error. Find + fix the silent catch. (A2-F2, A10) | P0 |
| W1-NEGATIVE-INV | `scripts/_split-credit-memos.mjs` (NEW) | 585 negative-total invoices misclassified as PAID. Split into `CreditMemo` model OR flag with `type='CREDIT'`. (A2-F3) | P0 |
| W1-SUBS-COLUMN-DRIFT | `src/app/api/ops/substitutions/route.ts` + `requests/route.ts` + `pm-daily-tasks/route.ts` | Stale column refs: `b.name` should be `b.companyName`; `j."builderId"` doesn't exist (use `Order.builderId`). PM daily task email empty for everyone. (A1-F1/F2/F3) | P0 |

### W2 — Schema sync (1 serial agent — schema is single-writer)

26 prod tables not in `schema.prisma` (including 20,804 `ProductSubstitution` rows blind). 49 models with column drift. Pull every prod column into the Prisma schema additively. NO destructive ops. After: `prisma generate`, no migration to run (everything already in DB). (A7)

Estimated: 2 hours for one careful agent.

### W3 — Cron + integration repairs (3 agents)

| Agent | Scope | Severity |
|---|---|---|
| W3-GMAIL-ARRAY-2 | `src/lib/integrations/gmail.ts` | 28% cron failure rate — second hand-rolled `'{...}'` literal that prior fix missed. Switch raw INSERT to `prisma.communicationLog.create()`. (A4) | P0 |
| W3-CRON-OBSERVE | 5 crons + `src/lib/cron.ts` schedule constants | `morning-briefing`/`weekly-report`/`collections-email`/`nuc-alerts`/`collections-ladder` not logging to CronRun. Add `withCronRun` wrappers. Reconcile schedule strings with `vercel.json`. (A3) | P1 |
| W3-INFLOW-SYNCAT | `src/app/api/cron/inflow-sync/route.ts` | `IntegrationConfig.lastSyncAt` not bumped after success → dashboard shows stale-by-5d. Single `update` call. (A4) | P2 |

### W4 — Permissions tightening (1 R7 agent)

Add ~30 missing `API_ACCESS` entries (Pile B silent default-deny). Add `requireDevAdmin` to 8 unauthenticated migration/import/cleanup routes. Migrate `/api/ops/staff*` from inline header check to `requireStaffAuth({allowedRoles})`. Wire `checkStaffAuth` on `/api/ops/fleet` (currently leaks driver PII) + `/api/ops/inbox` mutation endpoints. (A6)

Estimated: 1 careful agent, 90 min.

### W5 — Frontend cleanup (1 agent, surgical)

Top P0 user-visible: 9 dead `onClick` placeholders on `sales/command-center`. The "View All" button on `jobs/[jobId]/profile`. Send-collection-email button alerting "not implemented" on `finance/cash`. Plus the 3 disabled-by-design buttons on `jobs/[jobId]` (link-to-order, assign-installer) which already require schema follow-up.

Top P1: 18 `.catch(() => {})` silent error swallows on `purchasing/page.tsx` PM/Builder/Vendor dropdowns.

(A5)

### W6 — Audit-coverage backfill (1 agent)

Add `audit()` calls to: `/api/admin/alert-mute`, `/api/admin/errors` DELETE, `/api/admin/builders/[id]` PATCH, `/api/admin/sync-catalog`, `/api/auth/dev-login` (also gate with `NODE_ENV !== 'production'`), `/api/hyphen/oauth/token`, `webhooks/inflow`, `webhooks/gmail`, `ops/substitutions/{approve,reject}`, `ops/products/[id]/substitutes/apply`. (A10)

### W7 — Sentry rewire (1 agent)

`src/lib/logger.ts:117` reads `(globalThis as any).Sentry` which is never assigned. Either:
- (a) Wire `globalThis.Sentry = await import('@sentry/nextjs')` in `instrumentation.ts`
- (b) Replace dead bridge with direct `Sentry.captureException(err)` in logger.ts
- (c) Decide Sentry is intentionally off and remove the dead reference + replace with `console.error` per environment

Pick one. Currently 100% of API errors are invisible. (A10)

---

## Tier 3 — Nate-action items (out of code scope)

| # | Action | Why |
|---|---|---|
| N1 | **Sync `BRAIN_API_KEY`** between NUC and Vercel | Brain ingest has been 401-ing for 8+ hours — `cfAuth: ok` field misleading (only checks env-var presence) |
| N2 | **Install `scripts/nuc-heartbeat.sh` on coordinator NUC** | 0 `NucHeartbeat` rows lifetime — Aegis side is correct, NUC side hasn't started |
| N3 | **Verify Stripe webhook URL registered in dashboard** | 0 `WebhookEvent` rows lifetime; either URL missing or secret wrong |
| N4 | Rotate `JWT_SECRET` in Vercel | Was leaked in public repo earlier |
| N5 | Rotate Neon DB password | Leaked in chat earlier |
| N6 | **Set `EMAILS_GLOBAL_KILL=true` in Vercel as launch insurance** | 8 builder-facing email paths still unguarded (incl. one shipping temp passwords) |
| N7 | Run `node scripts/_backfill-invoice-issuedat.mjs --apply` | Closes the AR aging "1-month gap" alarm |
| N8 | Run Pulte zombie cleanup | 246 `COMPLETE` Pulte jobs distorting dashboards |
| N9 | Decide: drop dead `EmailQueue` table + `Bpw*` tables | Pulte gone; queue not drained by anyone |
| N10 | Decide: Stripe live or not? If not, hide Stripe-dependent UI | Currently shows "0 payments received" with no explanation |

---

## Tier 4 — Strategic / multi-week decisions

| # | Decision | Context |
|---|---|---|
| S1 | QBO migration (Dawn → cloud) OR QBWC for Dawn's QBD | Decided in earlier session per `quickbooks-decision.md`. Dawn stays on QBD per Nate, so QBWC is the realistic path. ~2 weeks. |
| S2 | Vercel Blob migration for floor-plan uploads | Currently writes to ephemeral `/var/task` — files vanish on cold start. ~1 day. |
| S3 | NUC worker provisioning (SALES/MARKETING/OPS/CUSTOMER_SUCCESS) | Per CLAUDE.md "built but not yet provisioned." Until done, those module statuses are dark. |
| S4 | Sales Command Center: build out OR delete | 9 dead onClicks make it look like a stub. Either real implementation or hide it from sidebar. |
| S5 | Catalog migration on prod | Was concerned the tables didn't exist — A7 confirmed they DO. So this item closes. |

---

## What's actually clean (no action needed)

- **Invoice.balanceDue** = `total - amountPaid` matches across all 4,124 rows ✅
- **Order subtotal/tax/shipping = total** matches across all rows ✅
- **All 6 status enums** match Prisma exactly ✅
- **Door auth** fully hardened (R5's work — `requireStaffAuth` + audit on all 7 branches) ✅
- **API_ACCESS entries from R1** verified covering trim-vendors, tasks, jobs, sales newer routes ✅
- **Health endpoints** are accurate (`/api/health/ready` actually probes DB + checks env vars) ✅
- **CSRF middleware** still 0 gaps (per earlier A audit) ✅
- **All 4 webhooks** still pass idempotency ✅
- **PM/builder filter additions** working correctly (per F2 fix) ✅
- **Middleware-level executive gate** active (F1's fix) ✅
