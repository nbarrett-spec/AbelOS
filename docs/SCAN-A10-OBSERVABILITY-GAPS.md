# SCAN-A10 — Observability Gaps

**Agent:** SCAN-A10-OBSERVABILITY-GAPS · **HEAD:** 171a6b4 · **Mode:** READ-ONLY · **Date:** 2026-04-27

**Scope:** Find places the system silently fails — errors swallowed, logs that go nowhere, mutations without audit trail, missing telemetry. Cross-references prior `docs/AUDIT-A-MUTATION-SAFETY.md`.

---

## Audit log gaps (top 20 highest-blast-radius)

Confirmed against `git rev-parse HEAD = 171a6b4`. **18 of 20** gaps from Audit A still present. **Fixed since A:** `door/[id]` (entire mutation surface now audits — see `src/app/api/door/[id]/route.ts:337-557`). All others below were re-checked file-by-file and still ship zero `audit()` / `logAudit()` calls.

| # | Route | Method | Risk | File:line for fix |
|---|---|---|---|---|
| 1 | `admin/builders/[id]` | PATCH | **P0** identity edit, no trail | `src/app/api/admin/builders/[id]/route.ts:262` after `$executeRawUnsafe(UPDATE Builder)` |
| 2 | `admin/alert-mute` | POST/DELETE | **P0** alert suppression — cover-up vector | `src/app/api/admin/alert-mute/route.ts:79, 105` after `muteAlert/unmuteAlert` |
| 3 | `admin/errors` | DELETE | **P0** log purge — cover-up vector | `src/app/api/admin/errors/route.ts:170, 177` after each DELETE |
| 4 | `admin/sync-catalog` | POST | **P0** bulk Product overwrite, no in-handler auth check (relies on middleware), no audit | `src/app/api/admin/sync-catalog/route.ts:17` add at top + final |
| 5 | `admin/products/enrich` | POST | **P1** bulk product mutation | `src/app/api/admin/products/enrich/route.ts` at end of POST |
| 6 | `admin/webhooks/[id]` | POST | **P1** webhook replay from DLQ | `src/app/api/admin/webhooks/[id]/route.ts:87, 90` (replay success / mark failed) |
| 7 | `auth/dev-login` | POST | **P0** prod backdoor risk; no `NODE_ENV !== 'production'` gate, no audit | `src/app/api/auth/dev-login/route.ts:1` gate + audit |
| 8 | `auth/forgot-password` | POST | **P1** abuse forensics absent | `src/app/api/auth/forgot-password/route.ts` add audit on enter + on success |
| 9 | `auth/preferences` | PATCH | **P2** | `src/app/api/auth/preferences/route.ts` |
| 10 | `auth/profile` | PATCH | **P1** PII edit | `src/app/api/auth/profile/route.ts` |
| 11 | `auth/logout` | POST | **P2** | `src/app/api/auth/logout/route.ts` (INFO) |
| 12 | `ops/substitutions/requests/[id]/approve` | POST | **P0** allocation swap — money path | `.../approve/route.ts:158` after `prisma.$transaction` |
| 13 | `ops/substitutions/requests/[id]/reject` | POST | **P0** | `.../reject/route.ts` after status update |
| 14 | `ops/products/[productId]/substitutes/apply` | POST | **P0** allocation swap | `.../apply/route.ts` after `runAllocationSwap` |
| 15 | `ops/gold-stock/[kitId]/build` | POST | **P1** inventory consumption | `.../build/route.ts` (also missing try/catch) |
| 16 | `ops/gold-stock/[kitId]` | PATCH | **P1** kit edit | `.../[kitId]/route.ts` |
| 17 | `hyphen/oauth/token` | POST | **P0** Bearer token mint, no forensic trail | `src/app/api/hyphen/oauth/token/route.ts:103` after `result.ok` |
| 18 | `hyphen/orders` | POST | **P1** inbound PO ingest from Brookfield | `src/app/api/hyphen/orders/route.ts:62-65` after `recordHyphenEvent` |
| 19 | `hyphen/changeOrders` | POST | **P1** | `src/app/api/hyphen/changeOrders/route.ts` |
| 20 | `webhooks/inflow` + `webhooks/gmail` | POST | **P1** money-adjacent state sync, no `/admin/audit` visibility | `webhooks/inflow/route.ts:74`, `webhooks/gmail/route.ts` post-process |

**Fix shape:** add `await audit(request, '<ACTION>', '<Entity>', id, {...}, severity)` after success. Non-staff contexts (`hyphen`, `webhooks`) use `logAudit({staffId: 'webhook:<provider>', ...})`.

---

## Silent error swallowing

**Empty `catch {}` (no log, no return) — 18 sites.** Most are intentional (best-effort table-init) but several swallow real mutation failures:

- `src/app/api/ops/jobs/[id]/route.ts:236, 240, 245` — three `catch {}` swallow allocation/release-job-materials inside PATCH. **P1**: inventory.committed silently drifts.
- `src/app/api/orders/[id]/reorder/route.ts:65` — swallows cart-add failure. **P1** UX bug + no Sentry.
- `src/app/api/cron/allocation-health/route.ts:92` — swallows alert-creation. **P2**.
- `src/app/api/ops/receiving/[id]/receive/route.ts:454` — swallows Notification insert. Audit fires after. **P2**.
- `src/app/api/ops/seed-demo-data/route.ts:139-142` — Builder/AgentTask deletes. **P3** (seed only).

**`catch (e) { … 400/500 }` without log — 3 hot paths:**
- `src/app/api/admin/alert-mute/route.ts:44` — bad-JSON 400 is fine, but `muteAlert` errors fall to outer with no try/catch.
- `src/app/api/hyphen/orders/route.ts:42` and `changeOrders/route.ts:36` — `} catch { return 400 }` drops parser error; operator can't tell truncated vs malformed.

**Console-only swallow** (no `logger.error`, no Sentry):
- `src/app/api/admin/builders/[id]/route.ts:111, 309` — `console.error('Failed to fetch/update builder:', error)`. Sentry shim dead (see below).
- `src/app/api/admin/sync-catalog/route.ts` — entire bulk-write uses `console.log` for progress.

---

## Stale logging

- **`console.log/error/warn` violations: 1,110 total in `src/app/api/**`, 208 in `src/lib/**`.**
- Top 10 offenders:
  1. `src/app/api/cron/run-automations/route.ts` — 35
  2. `src/app/api/ops/staff/[id]/route.ts` — 12
  3. `src/app/api/ops/scan-sheet/route.ts` — 9
  4. `src/app/api/quote-request/instant/route.ts` — 8
  5. `src/app/api/ops/quotes/route.ts` — 7
  6. `src/app/api/ops/jobs/[id]/route.ts` — 7
  7. `src/app/api/ops/portal/installer/jobs/[jobId]/complete/route.ts` — 6
  8. `src/app/api/ops/orders/[id]/route.ts` — 6
  9. `src/app/api/ops/inspections/[id]/route.ts` — 6
  10. `src/app/api/ops/fleet/route.ts` — 6
- **Logger usage: only 39 `src/app/api/**` files import `@/lib/logger`** (out of 759 route files). Logger is the canonical structured-logging path; everything else is plain console writes that lose request-id correlation and (per the Sentry shim) Sentry routing.
- Logger is consistent **where used**, scattered **everywhere else**. Most ops/* routes default to `console.error` from the early-stage scaffolding.

---

## Rate limiting gaps

`src/lib/rate-limit.ts` exposes `checkRateLimit(...)`. Coverage on public endpoints (verified by grep):

| Endpoint | Rate-limited? |
|---|---|
| `auth/signup`, `auth/login`, `auth/forgot-password`, `auth/reset-password`, `auth/dev-login` | **Yes** |
| `builders/register`, `builders/quote-request` | **Yes** |
| `builders/messages` | **No** — public freetext ingest, **P1** |
| `builders/warranty` | **No** — public claim intake, **P1** |
| `quote-request/instant` | **No** — public, **P1** |
| `agent/email` | **No** — webhook is HMAC-signed (acceptable when secret set), but in dev fallback mode (`!webhookSecret && NODE_ENV !== 'production'`) it auths every request. **P2** if Vercel preview NODE_ENV is "preview" not "production". |
| `client-errors` | **No** — comment claims "implicit (browsers only call on crash)"; in practice anyone can curl-spam the beacon endpoint and pollute `ClientError`. **P2**. |

Hyphen `oauth/token` does rate-limit. Webhooks (stripe, inflow, hyphen, gmail) gate via signature, not rate.

---

## Sentry coverage

- **Wired:** Yes — `sentry.{client,server,edge}.config.ts` exist; `src/instrumentation.ts:60` imports the server config in nodejs runtime.
- **`globalThis.Sentry` shim is DEAD CODE.** `src/lib/logger.ts:117` reads `(globalThis as any).Sentry`, but **no file assigns** `globalThis.Sentry = Sentry`. Therefore every `logger.error()` only writes to the `ServerError` table — Sentry alerting is silently disabled for all caught-and-logged server errors except those Next.js auto-wraps. **P0.**
- **Routes calling `Sentry.captureException` directly:** 0 in `src/app/api/**`. Only `src/lib/cron-alerting.ts`, `src/lib/telemetry.ts`, and the React error boundaries call it.
- **Process hooks** in `instrumentation.ts:50,54` forward `uncaughtException`/`unhandledRejection` to logger — which then doesn't reach Sentry. Bridge broken.

---

## Cron handlers — early-return SUCCESS pattern

Per the brief, hyphen-sync had this pattern. Audit found **same anti-pattern** in:

- `src/app/api/cron/buildertrend-sync/route.ts:43-50` — `if (!config) finishCronRun('SUCCESS', skipped: true)`. Acceptable IF you trust the config check, but means a misconfig is invisible from `/admin/crons` health view.
- `src/app/api/cron/hyphen-sync/route.ts:41-46, 52-61` — two early-success exits.
- `src/app/api/cron/gmail-sync/route.ts:43-49` — returns 200 without recording CronRun at all when `GOOGLE_SERVICE_ACCOUNT_KEY` unset. **P1**: cron looks "never ran" in admin/crons rather than "skipped — config missing."
- `src/app/api/cron/bolt-sync/route.ts:47-53` — same as gmail-sync. Returns success without `startCronRun`. **P1.**

The pattern itself isn't wrong (you don't want a flapping FAILURE on intentional skip), but **gmail-sync and bolt-sync skip _without_ creating any CronRun row**, so admin/crons can't distinguish "deployment dropped the schedule" from "config-gated skip." The hyphen/buildertrend pattern (record + 'SUCCESS' + skipped flag) is correct; gmail-sync/bolt-sync is incorrect.

---

## Audit-related silent failures

- 232 sites use the pattern `await audit(...).catch(() => {})` — superficially worrying, but `src/lib/audit.ts:135-152` already logs internally to both `console.warn` and `logger.error('audit_log_write_failed', ...)`. The double-swallow is acceptable. **No P0 here.**
- The bigger concern is **insertions to `AuditLog` via raw SQL in `src/app/api/agent-hub/actions/log/route.ts`** (called out in the prior A audit) — bypasses `publishEvent` fan-out, so live-stream consumers miss those events. **P2.**

---

## Health endpoints

- `/api/health` (`src/app/api/health/route.ts`) — true liveness, no deps. Always returns 200. Correct.
- `/api/health/ready` (`src/app/api/health/ready/route.ts`) — calls `runReadinessChecks()` from `src/lib/readiness.ts:46-90`. Checks DB roundtrip + REQUIRED_ENV_VARS. Returns 503 on failure. **Accurate, not a fake liveness.**
- `/api/health/crons` exists but is read-side. Not assessed for false-OK.

---

## Findings

### P0 — silent loss of money / identity / log integrity
1. **`logger.error` → Sentry bridge is dead.** `globalThis.Sentry` is never set, so 100% of structured server errors never reach Sentry. All P0 alerting goes only to the `ServerError` Postgres table. Fix: assign `globalThis.Sentry = Sentry` inside `sentry.server.config.ts`, OR import Sentry directly in `logger.ts`.
2. **`/api/admin/alert-mute` POST/DELETE** — no audit on alert suppression. Cover-up vector (mute a real fire, no trace). Add `audit(request, 'ADMIN_ALERT_MUTE'|'ADMIN_ALERT_UNMUTE', 'Alert', alertId, {...}, 'CRITICAL')` at `route.ts:79, 105`.
3. **`/api/admin/errors` DELETE** — no audit on log purge. Same cover-up vector. Add `audit(...)` at `route.ts:170, 177`.
4. **`/api/admin/builders/[id]` PATCH** — no audit on identity edit. Add at `route.ts:262`.
5. **`/api/auth/dev-login`** — no `NODE_ENV !== 'production'` gate AND no audit. If env config drifts, this is a loaded gun. Hard-gate + audit CRITICAL.
6. **`/api/hyphen/oauth/token`** — Bearer mint with zero forensic trail. Add audit at `route.ts:103` after success.
7. **`ops/substitutions/{approve,reject}` + `ops/products/[id]/substitutes/apply`** — money-path allocation swaps with no audit. Three files, ~30min total.

### P1 — looks fine until it doesn't
1. **gmail-sync / bolt-sync skip without CronRun row** — admin/crons shows "stale" not "config-gated." Add `startCronRun` + `finishCronRun('SUCCESS', skipped:true)` like hyphen-sync does.
2. **`ops/jobs/[id]/route.ts:236, 240, 245`** — three `catch {}` swallow allocation/release failures during job-status PATCH. Inventory.committed silently drifts. Replace with `logger.warn('job_alloc_release_failed', e, { jobId: id, status: newStatus })`.
3. **`webhooks/{inflow,gmail}` no audit on inbound** — Stripe + Hyphen webhooks audit; these don't. Match the pattern (one `logAudit` call after `ensureIdempotent`).
4. **`builders/{messages,warranty}`, `quote-request/instant`** — public endpoints, no rate limit. Add `checkRateLimit(req, perIp, 10/min)`.
5. **`hyphen/{orders,changeOrders}` JSON-parse errors** drop context. Replace `} catch { return 400 }` with `} catch (e) { logger.warn('hyphen_orders_bad_json', e); return 400 }`.

### P2 — noise / polish
1. **1,110 `console.log/error/warn` calls in API routes; 39 files use `@/lib/logger`.** Top 10 offenders listed above. Cleanup is mechanical (find/replace patterns) but not blocking.
2. **`globalThis.Sentry` shim** in `logger.ts:115-126` should be deleted once direct Sentry import lands.
3. **`agent-hub/actions/log` raw-SQL AuditLog insert** bypasses `publishEvent`. Refactor to `logAudit()`.
4. **`client-errors` beacon** unrate-limited. Browsers don't spam, but a malicious client can.

---

## Methodology

Diffed top-20 priority routes from `AUDIT-A-MUTATION-SAFETY.md` §1 vs current HEAD; grepped `audit(`/`logAudit(` per file. Searched `try {...} catch {}` and `catch (e) { return ... 500 }` across `src/app/api/**`. Counted `console.log/error/warn` per file. Walked Sentry config + `globalThis.Sentry` references. Spot-read every cron with early `finishCronRun('SUCCESS')`. Verified rate-limit usage on public endpoints. Read `/api/health` + `/api/health/ready` end-to-end. `npx tsc --noEmit` clean. No code modified.
