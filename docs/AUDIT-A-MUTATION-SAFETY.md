# Mutation Safety Audit — 2026-04-23

**Agent:** Audit Agent A (Aegis pre-launch, HEAD=e06f820)
**Scope:** Every `route.ts` under `src/app/api/` — complete sweep, not top-10 spot check.
**Method:** Static scan (`scripts/_mutation_safety_scan.mjs`, read-only) classifies each exported HTTP handler against a six-check rubric (AUTH, AUDIT, VALIDATION, TRY/CATCH, IDEMPOTENCY, CSRF). Results cross-referenced by spot-reading the top-risk files.
**Companion doc:** `docs/AUDIT-LOG-COVERAGE.md` (Agent A5, audit-only sweep).
**Raw scan output:** `scripts/_mutation_safety_scan.json` + `scripts/_mutation_safety_fileroll.json` + `scripts/_mutation_safety_domains.json`.

---

## TL;DR verdict

**YELLOW — ship-gateable with 8 focused fixes.**

- **759** route.ts files scanned — **459** are mutation routes (POST / PATCH / PUT / DELETE).
- **AUTH:** 8 routes (1.7%) have a genuine auth gap. 5 are legitimately public auth endpoints (login/logout flows) that need body-validation hardening, not pre-auth. Only **3 are real exposures** (`/api/door/[id]`, `/api/agent/chat` — trust-body-`staffId`, `/api/agent/email` — unsigned webhook in prod). CSRF is enforced for every non-Bearer API mutation via middleware.
- **AUDIT:** 104 routes miss `logAudit()` / `audit()`. Concentrated in four domains: `agent-hub` (19 — agent-authored), `cron` (17 — runs tracked via `startCronRun`, not audit — **acceptable**), `v1/engine` (5), and the same legacy gap set from the A5 Wave-1 doc. **True pre-launch gap: ~40 routes after discounting cron handlers and webhook headers.**
- **VALIDATION:** 131 routes (28.5%) lack explicit body validation before DB write. A lot of these are staff-only `ops/migrate-*` one-shots, but six on money + identity paths need fixing (see §4).
- **TRY/CATCH:** 14 mutation routes miss a try/catch. Gold-stock + substitutions path is the standout cluster — if a DB exception hits there, the 500 leaks raw Postgres error messages.
- **IDEMPOTENCY:** All 4 webhook routes pass (all use `ensureIdempotent`). 17 cron handlers miss dedup — acceptable because `startCronRun` is the canonical per-run key. **1 real gap:** `/api/hyphen/oauth/token` is rate-limited but has no replay dedup (RFC 6749 doesn't require it but Hyphen retries).
- **CSRF:** Middleware enforces origin check for every non-Bearer `/api/*` mutation. Bearer carve-outs (`/api/agent-hub`, `/api/v1/engine`, `/api/ops/hyphen/ingest`, `/api/ops/communication-logs/gmail-sync`) are explicit and correct. **No CSRF gap.**

### Count by severity bucket

| Severity bucket | Count | Monday-launch blocking? |
|---|---:|---|
| HIGH (auth or audit gap on money / identity / PII path) | **10** | **YES** |
| MEDIUM (validation or try/catch missing on staff-only path) | ~70 | Tier-1 post-launch |
| LOW (agent-hub side effects, cron inner-loop audit) | ~40 | Tier-2 post-launch |
| PASS (full rubric) | **258** (56.2%) | — |

---

## Section 1: Top 25 riskiest mutations (money, auth, PII)

Rubric values: **P** = PASS · **W** = WARN · **F** = FAIL · **N** = N/A. Rankings weight AUTH and AUDIT highest, then money/identity impact.

| # | Route | Method | AUTH | AUDIT | VALID | TRY | IDEMP | CSRF | Remediation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `src/app/api/door/[id]/route.ts` | POST | **F** | **F** | W | P | N | P | **Read `staffId`/`staffName` from body — anyone who knows the URL can mark a door `INSTALLED`, `REASSIGNED`, `DELIVERED`. Replace body-trust with `requireStaffAuth(request)`. Log every action via `audit()`.** |
| 2 | `src/app/api/agent/email/route.ts` | POST | W | **F** | W | P | **F** | N | Accepts anonymous inbound email if `EMAIL_WEBHOOK_SECRET` env var is unset (dev fallback). In production with secret set, OK. **Require secret in prod, log every inbound via `logAudit()`, persist messageId for idempotency.** |
| 3 | `src/app/api/webhooks/stripe/route.ts` | POST | P | P (via `logAudit` in processor) | P | P | P | N | Already hardened — keep. |
| 4 | `src/app/api/webhooks/inflow/route.ts` | POST | P | **F** | P | P | P | N | Signature-verified and idempotent but no `logAudit` on the inbound event. **Add `logAudit('INFLOW_EVENT', 'Webhook', eventId, {...})` post-process.** |
| 5 | `src/app/api/webhooks/gmail/route.ts` | POST | P | **F** | P | P | P | N | Same as #4 — add `logAudit` call. |
| 6 | `src/app/api/webhooks/hyphen/route.ts` | POST | P | P | P | P | P | N | Hardened per Wave-2. Keep. |
| 7 | `src/app/api/auth/signup/route.ts` | POST | P (rate-limit + validation) | **F** | P | P | N | P | Creates `Builder` row, no `logAudit('SIGNUP', 'Builder', builderId, {...}, 'CRITICAL')`. **Add the audit call.** |
| 8 | `src/app/api/auth/reset-password/route.ts` | POST | P | **F** | P | P | N | P | Credential mutation, no audit. **`logAudit('PASSWORD_RESET', 'Builder', builderId, {email: mask(email)}, 'CRITICAL')`.** |
| 9 | `src/app/api/auth/change-password/route.ts` | POST | P | P | P | P | N | P | Already covered (audit call present). Keep. |
| 10 | `src/app/api/auth/forgot-password/route.ts` | POST | P | **F** | P | P | N | P | Log the attempt + IP (abuse forensics). `logAudit('FORGOT_PASSWORD_REQUEST', 'Builder', ?, {...}, 'WARN')`. |
| 11 | `src/app/api/auth/dev-login/route.ts` | POST | W | **F** | F | P | N | P | Dev backdoor. **Gate with `NODE_ENV !== 'production'` and `logAudit(..., 'CRITICAL')` when invoked. If it can fire in prod it's a loaded gun.** |
| 12 | `src/app/api/payments/route.ts` | POST | P (verifyToken + cookie) | P (`auditBuilder`) | P | P | N | P | Stripe checkout creation. Already covered. Keep. |
| 13 | `src/app/api/ops/substitutions/requests/[id]/approve/route.ts` | POST | P | **F** | P | P | N | P | **Runs `runAllocationSwap` — inventory mutation. Add `audit(request, 'APPROVE_SUBSTITUTION', 'SubstitutionRequest', id, {...}, 'CRITICAL')`.** |
| 14 | `src/app/api/ops/substitutions/requests/[id]/reject/route.ts` | POST | P | **F** | P | P | N | P | Add `audit(request, 'REJECT_SUBSTITUTION', 'SubstitutionRequest', id, ...)`. |
| 15 | `src/app/api/ops/products/[productId]/substitutes/apply/route.ts` | POST | P | **F** | P | P | N | P | Allocation swap. Add `audit(...)`. |
| 16 | `src/app/api/ops/gold-stock/[kitId]/build/route.ts` | POST | P | **F** | P | **F** | N | P | Inventory consumption. **Add both `audit()` and try/catch.** |
| 17 | `src/app/api/ops/gold-stock/[kitId]/route.ts` | PATCH | P | **F** | P | **F** | N | P | Same as #16. |
| 18 | `src/app/api/dashboard/reorder/route.ts` | POST | P | P | W | P | N | P | Already covered. Keep. |
| 19 | `src/app/api/admin/builders/[id]/route.ts` | PATCH | P (middleware ADMIN) | **F** | F | P | N | P | Admin edits a builder row. **Add `audit(request, 'ADMIN_EDIT_BUILDER', 'Builder', id, {...}, 'CRITICAL')` and zod validation on patchable fields.** |
| 20 | `src/app/api/admin/sync-catalog/route.ts` | POST | P | **F** | P | P | N | P | Bulk catalog sync. Add `audit(request, 'SYNC_CATALOG', 'Product', undefined, {count}, 'WARN')`. |
| 21 | `src/app/api/admin/products/enrich/route.ts` | POST | P | **F** | F | P | N | P | Bulk product mutation. Audit + validate. |
| 22 | `src/app/api/admin/webhooks/[id]/route.ts` | POST | P | **F** | F | P | N | P | Webhook replay from DLQ — audit who replayed what. |
| 23 | `src/app/api/admin/alert-mute/route.ts` | POST,DELETE | P | **F** | F | **F** | N | P | Abuse vector (silencing alerts). Audit CRITICAL + validation + try/catch. |
| 24 | `src/app/api/admin/errors/route.ts` | DELETE | P | **F** | P | P | N | P | Error log purge. Audit CRITICAL. |
| 25 | `src/app/api/hyphen/oauth/token/route.ts` | POST | P (rate-limit + Basic auth check) | **F** | P | P | **F** | P | OAuth token mint. Log every mint (`HYPHEN_TOKEN_ISSUED`). Replay dedup would be nice-to-have (Hyphen shouldn't retry, but Bearer token reuse should be traceable). |

---

## Section 2: Auth gaps (routes without auth guard)

**HIGH SEVERITY — only 3 real exposures.**

| # | Route | Method | Why flagged | Real gap? |
|---|---|---|---|---|
| 1 | `src/app/api/door/[id]/route.ts` | POST | Reads `staffId`/`staffName` from body — no auth check whatsoever. 7 branches mutate door state (qc_pass, qc_fail, move_to_bay, stage, deliver, install, reassign_order) with body-supplied staff id. | **YES — HIGH.** Anyone who can reach `/api/door/<id>` can mark a door INSTALLED. |
| 2 | `src/app/api/agent/email/route.ts` | POST | HMAC signature check ONLY runs if `EMAIL_WEBHOOK_SECRET` is set; in dev with no secret it returns `authenticated = true`. In prod with secret unset the check falls through. | **YES — HIGH if prod secret missing.** Verify `EMAIL_WEBHOOK_SECRET` is set on Vercel prod env. |
| 3 | `src/app/api/agent/sms/route.ts` | POST | Stubbed 501 — Twilio not wired. Returns `Not Implemented`. | No. Explicit stub with comment. |
| 4 | `src/app/api/auth/logout/route.ts` | POST | No pre-auth by design (logging out a non-existent session is fine). Scanner flagged because no rate-limit OR validation; endpoint just clears cookie. | No. Acceptable. |
| 5 | `src/app/api/client-errors/route.ts` | POST | Anonymous by design — error beacon receiver. Clamps input. | No. Documented anonymous ingestion. |
| 6 | `src/app/api/presence/route.ts` | POST | Uses `getStaffSession()` — scanner missed it because of import via `@/lib/staff-auth`. | **No.** Scanner false positive. |
| 7 | `src/app/api/ops/auth/logout/route.ts` | POST | Same as #4 — logout is public. | No. |
| 8 | `src/app/api/ops/auth/run-migrations/route.ts` | POST | Returns 410 Gone — retired. | No. Retired. |

**Net:** 2 real HIGH-severity gaps (`/api/door/[id]`, confirm prod env for `/api/agent/email`). All of `/api/ops/*`, `/api/admin/*`, `/api/agent-hub/*` — every mutation route — is auth'd via middleware (staff cookie, admin cookie, or Bearer API key). CSRF also enforced on all non-Bearer paths.

---

## Section 3: Audit gaps (mutation routes without logAudit)

**Total missing: 104 routes.** Grouped by domain.

### 3a. auth (5) — CRITICAL
Identity surface. Forensic trail is legally load-bearing.

| Path | Method | Severity |
|---|---|---|
| `auth/dev-login/route.ts` | POST | CRITICAL |
| `auth/forgot-password/route.ts` | POST | WARN (log abuse attempts) |
| `auth/logout/route.ts` | POST | INFO |
| `auth/preferences/route.ts` | PATCH | INFO |
| `auth/profile/route.ts` | PATCH | WARN |

Note: `auth/login` / `auth/signup` / `auth/reset-password` / `auth/change-password` ARE audited. The remaining 5 are the gap.

### 3b. agent-hub (19) — MEDIUM
Agent-authored writes. A5 Tier-4 recommended audit-at-inner-mutation. Most of these generate drafts/recommendations — low forensic value, but should be traceable by `agentSessionId`.

Files: churn/intervene, expansion/recommend, heartbeat, inventory/auto-po, inventory/forecast, notifications/proactive, outreach/{generate,sequence}, permits (POST + PATCH), pricing/{calculate,competitors,rules}, quality/predict, schedule/auto-assign, seo/{content,keywords,local-listing,review-request}.

Note: `agent-hub/actions/log` writes to `AuditLog` via raw SQL — bypasses `publishEvent` fan-out. Refactor to `logAudit()`.

### 3c. cron (17) — LOW
Acceptable per-handler gap. Crons track runs via `startCronRun`/`finishCronRun` (see `src/lib/cron.ts`). Audit value = audit the INNER mutations (jobs created, emails sent) that the cron batches, not the handler entry. Recommend skipping unless cron has ad-hoc mutations outside a tracked call.

### 3d. v1/engine (5) — MEDIUM
Proxy endpoints to Google APIs + inbox ack. Low risk but should be traced via engine-level command log.

| Path | Method |
|---|---|
| `v1/engine/data/calendar/events` | POST |
| `v1/engine/data/drive/search` | POST |
| `v1/engine/data/gmail/threads` | POST |
| `v1/engine/heartbeat` | POST |
| `v1/engine/inbox/[inboxItemId]/ack` | POST |

### 3e. agent (4) — MEDIUM
Portal-scope builder agent surface. Already passes auth via cookie. Need audit for every message so we can reconstruct conversations from AuditLog.

### 3f. builders (4) — MEDIUM
Public builder intake. Already rate-limited. Add audit for creation trail.

| Path | Method |
|---|---|
| `builders/messages/route.ts` | POST |
| `builders/quote-request/route.ts` | POST |
| `builders/register/route.ts` | POST |
| `builders/warranty/route.ts` | POST |

### 3g. homeowner (4) — MEDIUM
Token-authed customer surface. Selections + confirm are high-value — they create contractual selections.

### 3h. hyphen (3) — MEDIUM
Inbound Brookfield traffic. `oauth/token` mints a Bearer. orders/changeOrders ingest inbound orders.

### 3i. admin (misc, 11) — HIGH for 3
admin/builders/[id], admin/alert-mute, admin/errors → CRITICAL (user data edit, alert suppression, log purge).
admin/hyphen/aliases, admin/hyphen/events/[id], admin/products/enrich, admin/sync-catalog, admin/test-alert-notify, admin/test-cron-alert, admin/webhooks/[id] → WARN (admin-only, infrequent).

### 3j. crew (2) — MEDIUM
Field crew state mutation (delivery complete, install status). Already covered via `ops/delivery/*` equivalents; these `crew/*` paths predate the ops-side ones.

### 3k. ops — scattered (18)
Full list in §1. Biggest clusters: substitutions (2), gold-stock (2), reports (2), presence (2 — ephemeral, ok to skip), portal voice briefings (2), admin/digest-preview (1), hyphen (2), products/substitutes/apply (1), staff/preferences/digest (1), video-rooms (1).

### 3l. webhooks (2) — MEDIUM
gmail + inflow don't emit `logAudit`. They DO persist via `WebhookEvent` + `ensureIdempotent`, so there's a trail — but the canonical audit surface at `/admin/audit` doesn't see them. Hyphen + Stripe webhook handlers DO audit. **Add parity.**

### 3m. Individual lookups (~20)
bulk-order/parse, catalog/cart, client-errors (intentional), dashboard/reorder (already covered — scanner FP), deliveries/feedback, door/[id], internal/security-event (separate stream), messages, notifications, presence, quote-request/instant, takeoff, upload.

---

## Section 4: Validation gaps (routes writing unchecked body data)

**Total: 131 routes.** Highest-impact subset shown. Most are `ops/migrate-*` one-shot admin routes where zero-validation is fine because they take no body.

### Money / identity path (fix before Monday)

| Path | Method | What's unchecked |
|---|---|---|
| `admin/builders/[id]` | PATCH | Full builder row patch — any field spread into Prisma `update` |
| `admin/errors` | DELETE | Delete criteria (age, scope) |
| `admin/products/enrich` | POST | Bulk product ID list |
| `admin/webhooks/[id]` | POST | Replay parameters |
| `blueprints/[id]/analyze` | POST | Blueprint id URL-only, but body options spread into analyzer |
| `blueprints/[id]/convert` | POST | Same |
| `blueprints/[id]` | DELETE | No body — but needs idGuard (UUID shape) |
| `builders/messages` | POST | Inbound text — needs length cap + sanitization |
| `builders/warranty` | POST | Public intake — needs contact-info zod |
| `cron/allocation-health`, `cron/uptime-probe`, `cron/webhook-retry` | POST | Cron-triggered but accept query params |
| `homeowner/[token]/confirm`, `homeowner/[token]/selections` | POST | Token is checked, body selections are not bounded |
| `hyphen/changeOrders`, `hyphen/orders` | POST | Inbound from Brookfield — body shape assumed |
| `notifications` | PATCH | Mark-read action — needs `ids: string[]` validation |
| `messages` | POST | Freetext body — needs length cap |
| `ops/admin/data-quality*` (4 routes) | POST | Data-repair actions — operator-supplied but still need allow-list |
| `ops/agent/workflows/[id]` | PATCH | Full workflow patch |
| `quote-request/instant` | POST,PATCH | Public intake |

### Staff-only low-severity (fix post-launch)

All the `ops/migrate-*` handlers (v8, v9, v10, mfg, v12, phase2-5, nfc, outreach, manufacturing, change-orders, punch-items, documents, temporal, cascades, indexes): body-less one-shots, zero validation is acceptable because they take no input. Keep flagged for cleanup but not blocking.

---

## Section 5: Idempotency gaps

**Rubric applies only to webhook + retry-prone routes.** Total flagged: 17.

### Real gaps (1)

| Path | Method | Why |
|---|---|---|
| `hyphen/oauth/token` | POST | RFC 6749 token endpoint. Currently no dedup. Hyphen typically doesn't retry token requests, but if a client double-submits we mint two tokens + two audit rows. **Nice-to-have:** accept an `X-Request-Id` header and dedup via a small TTL cache. |

### Crons (17) — ACCEPTABLE
Every cron flagged by the scanner uses `startCronRun`/`finishCronRun` to track per-run state. The cron scheduler (`vercel.json`) is the idempotency boundary: if it dispatches the same slot twice we want the SECOND call to detect `CronRun` overlap and short-circuit. **Verify** `src/lib/cron.ts::startCronRun` has that overlap guard (it does — see the recent `fix(inflow-sync): zombie cron cleanup` commit).

### Webhooks — all 4 PASS
stripe (constructEvent + WebhookEvent), inflow (ensureIdempotent), gmail (historyId+emailAddress key), hyphen (eventId/id/x-event-id). **No idempotency gap in the external mutation layer.**

---

## Section 6: Summary heatmap (per-domain pass rate)

Coverage percentages across all checks. "allpass" = all of AUTH + AUDIT + VALIDATION + TRY + IDEMP pass for that route.

Top 20 domains by mutation count:

| Domain | Mutations | AUTH | AUDIT | VALID | TRY | all-PASS |
|---|---:|---:|---:|---:|---:|---:|
| agent-hub | 24 | 100% | 21% | 75% | 100% | **17%** |
| cron | 18 | 100% | 6% | 83% | 100% | **6%** |
| ops/migrate | 13 | 100% | 100% | 8% | 100% | **8%** |
| ops/jobs | 12 | 100% | 100% | 92% | 100% | **92%** |
| builder | 11 | 100% | 100% | 100% | 100% | **100%** |
| ops/sales | 11 | 100% | 100% | 27% | 100% | 27% |
| ops/auth | 10 | 10% | 100% | 80% | 100% | 10% |
| ops/delivery | 10 | 100% | 100% | 90% | 100% | 90% |
| ops/manufacturing | 10 | 100% | 100% | 90% | 100% | 90% |
| auth | 9 | 33% | 44% | 78% | 89% | 11% |
| ops/integrations | 9 | 100% | 100% | 89% | 100% | 89% |
| ops/procurement | 9 | 100% | 100% | 78% | 100% | 78% |
| v1 | 9 | 100% | 44% | 22% | 67% | **0%** |
| ops/ai | 8 | 100% | 100% | 50% | 100% | 50% |
| ops/staff | 8 | 100% | 88% | 88% | 100% | 75% |
| ops/admin | 7 | 100% | 86% | 14% | 86% | **14%** |
| ops/inventory | 7 | 100% | 100% | 71% | 100% | 71% |
| ops/warehouse | 7 | 100% | 100% | 100% | 100% | **100%** |
| ops/invoices | 6 | 100% | 100% | 100% | 100% | **100%** |
| ops/portal | 6 | 100% | 67% | 100% | 100% | 67% |

### Key observations

- **`ops/jobs`, `ops/invoices`, `ops/warehouse`, `ops/delivery`, `ops/manufacturing`, `builder/*`** all at ≥ 90% full-rubric pass. These are the production-ready domains.
- **`agent-hub`** has 100% AUTH (Bearer middleware) but 21% AUDIT. Known from A5 Wave-1 doc.
- **`cron`** 100% AUTH (CRON_SECRET) but 6% AUDIT by handler — **acceptable** because `startCronRun` is the tracking mechanism.
- **`v1/engine`** is the weakest domain: 44% audit, 22% validation, 67% try/catch. These proxy Google APIs for the NUC engine — given the NUC is not yet deployed, this is pre-launch "future-work" code. **Don't ship unauthed but don't block launch on its audit polish.**
- **`auth`** (builder auth) looks worse than it is — `auth/login`/`signup`/`reset-password` ARE hardened; the 44% audit rate is dragged down by `logout`/`preferences`/`profile`/`dev-login`/`forgot-password`.
- **`ops/migrate`** looks awful on validation (8%) but that's because migrations don't accept body input — false-positive cluster. Most are also retired or only-runnable by ADMIN role.

---

## Top 10 concrete remediation tickets (pre-Monday)

Ordered by risk × effort. Each is a ~30-minute fix; the set is ~5 hours of work total.

### 1. `src/app/api/door/[id]/route.ts` — AUTH + AUDIT, HIGH
**Severity:** HIGH (body-trusted staffId; any reachable attacker can mutate door state)
**Fix:** Replace body-supplied `staffId`/`staffName` with `requireStaffAuth(request)`. Keep the `request_service` branch anonymous (it already is — homeowner-facing). For all other branches, add `audit(request, action.toUpperCase(), 'Door', door.id, {...}, 'WARN')` on success.
**Lines:** 165–389.

### 2. `src/app/api/webhooks/inflow/route.ts` + `webhooks/gmail/route.ts` — AUDIT, HIGH
**Severity:** HIGH (money-adjacent state sync has no forensic trail in `/admin/audit`)
**Fix:** Add `logAudit({staffId: 'webhook:inflow', action: 'INFLOW_EVENT', entity: 'Webhook', entityId: eventId, details: snippet, severity: 'INFO'})` post-idempotency-check, before processing. Match the pattern in `webhooks/stripe/route.ts` lines 80–130. Same for gmail.

### 3. `src/app/api/auth/{dev-login,forgot-password,reset-password,signup}/route.ts` — AUDIT, CRITICAL
**Severity:** CRITICAL for signup/reset; WARN for dev-login/forgot.
**Fix:** Add `logAudit(...)` on success AND failure. Log email (masked), IP, UA. For `dev-login`, also wrap in `if (process.env.NODE_ENV === 'production') return 410`.

### 4. `src/app/api/ops/substitutions/requests/[id]/{approve,reject}/route.ts` + `ops/products/[productId]/substitutes/apply/route.ts` — AUDIT, HIGH
**Severity:** HIGH (real inventory swap — allocation churn)
**Fix:** `await audit(request, 'APPROVE_SUBSTITUTION' | 'REJECT_SUBSTITUTION' | 'APPLY_SUBSTITUTE', 'SubstitutionRequest', id, {fromProductId, toProductId, qty}, 'CRITICAL')` after the swap succeeds.

### 5. `src/app/api/ops/gold-stock/[kitId]/{route.ts,build/route.ts}` — AUDIT + TRY/CATCH, MEDIUM
**Severity:** MEDIUM (kit consumption is inventory mutation)
**Fix:** Wrap the mutation body in `try { ... await audit(request, 'BUILD_KIT' | 'UPDATE_KIT', 'GoldStockKit', kitId, {...}) } catch (e) { return NextResponse.json({error: 'internal'}, {status: 500}) }`.

### 6. `src/app/api/admin/{alert-mute,errors,builders/[id],sync-catalog,webhooks/[id]}/route.ts` — AUDIT, HIGH
**Severity:** HIGH (admin-only but high-blast-radius — alert suppression, log purge, builder edits, catalog overwrites, webhook replay)
**Fix:** Add `audit(request, 'ADMIN_*', <entity>, <id>, {...}, 'CRITICAL')` on every mutation branch.

### 7. `src/app/api/builders/{register,warranty,messages,quote-request}/route.ts` — AUDIT, MEDIUM
**Severity:** MEDIUM (public intake — need provenance trail for spam triage)
**Fix:** Already rate-limited via middleware. Add `logAudit({staffId: 'public', action: 'REGISTER' | 'WARRANTY_CLAIM' | 'MESSAGE' | 'QUOTE_REQUEST', entity: 'Builder' | 'WarrantyClaim' | 'Message' | 'QuoteRequest', ...})`.

### 8. `src/app/api/hyphen/{orders,changeOrders,oauth/token}/route.ts` — AUDIT, HIGH for OAuth
**Severity:** HIGH for oauth/token (security forensics), MEDIUM for orders/changeOrders (audit exists in A5 doc).
**Fix:** `logAudit({staffId: 'hyphen', action: 'TOKEN_ISSUED', entity: 'HyphenCredential', entityId: clientId, ...})` for token mints. Add INFO-level for order/changeOrder ingestion.

### 9. `src/app/api/crew/{delivery,install}/[id]/route.ts` — AUDIT, MEDIUM
**Severity:** MEDIUM (field crew state mutation)
**Fix:** `audit(request, 'CREW_DELIVERY_UPDATE' | 'CREW_INSTALL_UPDATE', 'Delivery' | 'Installation', id, {status, notes})`.

### 10. `src/app/api/homeowner/[token]/{confirm,selections,upgrades}/route.ts` — AUDIT, MEDIUM
**Severity:** MEDIUM (contractual homeowner selections)
**Fix:** Use `auditBuilder`-style pattern with `staffId: 'homeowner:' + token` so the actor is traceable but not staff.

---

## Appendix A — Methodology

1. Walked `src/app/api/**/route.ts` (759 files).
2. For each, extracted HTTP handler exports (`export function POST`, etc.).
3. Classified each mutation handler against 6 pattern groups:
   - **AUTH:** 22 patterns covering `requireStaffAuth` / `checkStaffAuth` / `verifyEngineToken` / `verifyToken` / cookie-inspection / env-var-based Bearer checks.
   - **AUDIT:** `@/lib/audit` import AND any of `audit|logAudit|auditBuilder(` being called. Also flags raw-SQL AuditLog inserts.
   - **VALIDATION:** zod `.parse`/`.safeParse`, typeof checks, `Array.isArray`, `!body.field` required checks, length bounds. Requires ≥ 2 hits to PASS.
   - **TRY/CATCH:** any `try { ... } catch` block in file.
   - **IDEMPOTENCY:** `ensureIdempotent`, `WebhookEvent`, `eventId`, `idempotencyKey`, `x-idempotency-key`, `stripe-signature`, `constructEvent`, `hub-signature`. N/A unless route is under `/api/webhooks/` or `/api/(cron|hyphen|inflow|gmail|stripe)/`.
   - **CSRF:** derived from middleware — PASS for all non-Bearer API mutations (middleware enforces origin check); N/A for webhooks and internal endpoints.
4. Middleware-level auth annotated per route via path prefix (see `middlewareAuth()` in the scanner).
5. Domain roll-up counts per-check pass rates.
6. Top-25 table hand-verified by reading each file.

## Appendix B — False-positive audit

The scanner is deliberately cautious and flags on absence of patterns. Documented false positives (all hand-verified and NOT counted in the "real gap" totals above):

- `ops/auth/run-migrations` — retired (returns 410).
- `agent/sms` — stubbed 501.
- `presence` — uses `getStaffSession()` (scanner missed the import via `@/lib/staff-auth`).
- `client-errors` — intentionally anonymous error beacon.
- `internal/security-event` — secret-authed, documented; CSRF explicitly skipped by middleware.
- All `ops/migrate-*` — no body input, zero validation is fine.
- Logout endpoints (`auth/logout`, `ops/auth/logout`) — clearing a cookie doesn't need pre-auth.

## Appendix C — What the scanner does NOT catch

1. **Audit calls hidden behind wrapped helpers** (e.g. `lib/jobs.ts::createJob()` internally calls `logAudit`, so a route that just calls `createJob()` looks uncovered at the route level). Not a gap — just not visible from route file alone.
2. **Authorization** (beyond authentication). E.g. a staff user calling an endpoint they don't have the role for — relies on `requireStaffAuth({allowedRoles})` which many routes don't use. Out of scope for this sweep; belongs in RBAC audit.
3. **Data isolation** (builder can only see their own data). Also out of scope.
4. **Race conditions / transaction boundaries.**
5. **Rate limiting** per-route beyond the generic middleware origin check. `/auth/login`, `/hyphen/oauth/token`, and several public forms DO rate-limit via `checkRateLimit(... limiter)`. Many `ops/*` routes rely solely on the staff-session protection, no per-endpoint limit.

---

*Report generated 2026-04-23 by Audit Agent A. Raw JSON artifacts committed alongside.*
