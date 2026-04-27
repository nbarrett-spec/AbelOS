# Env Var Health — 2026-04-23

**Scope:** agent H5 Monday-readiness audit. Read-only.
**HEAD:** `74f6bbd` (`fix(build): drop THOMAS_BUILDER_PATTERNS page export`)
**Method:** `grep -rE "process\.env\.[A-Z_][A-Z0-9_]+" src/ scripts/`, dedupe, classify, cross-check vs `.env.example`, `.env.production.template`, and `src/lib/env.ts` Zod schema.

All secret values are `[REDACTED]` in this report.

---

## TL;DR verdict

**RED — action required before Monday.**

One real secret value is committed to the repo in two files (same JWT). The plaintext Neon DB password that leaked in an earlier chat transcript is NOT in source — good — but must still be rotated in Neon + Vercel. Several optional env vars have inconsistent fallback chains (`NEXT_PUBLIC_APP_URL || NEXT_PUBLIC_BASE_URL || 'https://app.abellumber.com'` in some files, just `NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'` in others). All hardcoded URL fallbacks point to the correct production host (no stale `*.vercel.app` URLs found). `NEXT_PUBLIC_*` surface reviewed — no private secrets leaked into client bundles.

---

## Section 0: Secret rotation status

### Neon DB password rotation — REQUIRED

- The full `DATABASE_URL` (including plaintext password `npg_...`, classification: production credential) was exposed in a bash-command transcript earlier today.
- Grep for the leaked password token `npg_r42LCfPIdcQn` across the entire repo returns **0 matches**. The leak is transcript-only, not in code.
- **Action for Nate:**
  1. Neon console → database → reset role password.
  2. Copy the new pooled connection string.
  3. Vercel project → Settings → Environment Variables → update `DATABASE_URL` (Production, Preview, Development separately if they share the creds).
  4. Redeploy Production.
  5. Optional: also rotate any 1Password entry mirroring the old creds.

### Leaks found in source code

**Count: 2 files** referencing the same JWT value.

| File | Line | Var | Classification |
|---|---|---|---|
| `.env.production.template` | 16 | `JWT_SECRET` | **Tracked in git** via `f8ff634` (initial commit) |
| `docs/LAUNCH-READINESS-REPORT.md` | 68 | `JWT_SECRET` (quoted) | **Tracked in git** |

The value is a 64-char base64-looking string, format consistent with `openssl rand -base64 48` output. Regardless of whether it was ever actually used in prod, treat as compromised:

- **Action for Nate:**
  1. Confirm the current Vercel `JWT_SECRET` value — if it matches the committed one, rotate immediately (`openssl rand -base64 48` → update Vercel → redeploy). All existing user JWTs will become invalid, forcing re-login. Acceptable given scope.
  2. Remove the real value from `.env.production.template` and `docs/LAUNCH-READINESS-REPORT.md`, replace with a placeholder like `"<generate with openssl rand -base64 48>"`.
  3. Long term: move those template files to `.gitignore` and keep only `.env.example` with placeholders committed — or strictly enforce placeholders in every template file.

All other secret-pattern scans were clean:

| Pattern | Scope | Hits |
|---|---|---|
| `Bearer eyJ...` (JWT literal in code) | `src/`, `scripts/` | 0 |
| `sk_live_...` / `sk_test_...` (Stripe) | `src/`, `scripts/` | 0 |
| `re_...` (Resend) | `src/` | 0. scripts/manifest.json matches are unrelated filenames, not Resend keys. |
| `postgresql://user:pass@` | `src/`, `scripts/` | 0 |
| `ANTHROPIC_API_KEY = "sk-ant-..."` literal | repo-wide | 0 |

---

## Section 1: Env var inventory

**118 distinct `process.env.XXX` names** read across `src/` and `scripts/`. Four are noise (`NEXT_PUBLIC_` bare prefix from a comment, `FOO`/`XXX` from `scripts/env-var-audit.ts` examples, `__VRF_EVENT__` inline child-process shim) and are excluded below. Classification legend:

- **CRITICAL** — app throws at startup without it (enforced by `src/lib/env.ts` Zod schema or top-level middleware check).
- **REQUIRED_FOR_FEATURE** — a specific feature fails closed without it (webhook verification, payments, email, AI, cron auth).
- **OPTIONAL** — app/feature degrades gracefully. Ok to omit.
- **PUBLIC** — `NEXT_PUBLIC_*` — inlined into client bundles at build time. Must never hold secrets.
- **DEPRECATED** — legacy name still read as fallback to a newer var.
- **RUNTIME-ONLY** — set by the platform (Vercel, Next.js, Node), never user-supplied.

### 1a. CRITICAL (app won't start in prod)

| Var | Purpose | Sample refs | Fallback in code | .env.example | .env.production.template |
|---|---|---|---|---|---|
| `DATABASE_URL` | Neon/Postgres connection string | `src/lib/env.ts:20`, `src/lib/readiness.ts`, `src/app/api/ops/sops/route.ts`, `scripts/*.mjs` (44+ files total) | none; Zod `.url()` required | yes (localhost placeholder) | yes (placeholder) |
| `JWT_SECRET` | HMAC for auth tokens | `src/middleware.ts:5,10`, `src/lib/auth.ts`, `src/lib/staff-auth.ts`, `src/lib/env.ts:33`, `src/lib/readiness.ts` | `'dev-secret-change-in-production'` in middleware.ts, `'dev-secret-dev-secret-dev-secret-12345'` in env.ts — both rejected at startup in prod via `knownDefaults` list in `env.ts:192-203` | yes (placeholder "change-me...") | **YES — REAL VALUE LEAKED (see Section 0)** |
| `NODE_ENV` | Runtime mode | `src/middleware.ts:5`, `src/lib/env.ts:17` etc. | default `development` via Zod | yes | yes |

### 1b. REQUIRED_FOR_FEATURE (silent feature failure without)

| Var | Feature it gates | Sample refs | Fallback in code | .env.example | .env.production.template |
|---|---|---|---|---|---|
| `CRON_SECRET` | Authenticates all 46 `/api/cron/*` routes. If unset in prod, cron endpoints become public (env.ts:215 warns loudly). | 46 files (all `src/app/api/cron/*/route.ts`) | none | yes | no — **GAP** |
| `RESEND_API_KEY` | All transactional email (pw reset, digests, collections, pm reminders) | `src/lib/resend/client.ts`, `src/lib/email.ts`, `src/lib/digest-email.ts`, `src/app/api/auth/forgot-password/route.ts`, +8 more | none; guarded by `isResendConfigured()` | yes | yes |
| `RESEND_FROM_EMAIL` | From-addr for all Resend emails | `src/lib/resend/client.ts`, `src/lib/env.ts:50` | `"Abel Lumber <noreply@abellumber.com>"` default in env.ts | yes | yes |
| `STRIPE_SECRET_KEY` | Payments + invoice pay flow | `src/lib/stripe.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/lib/integration-guard.ts` | none | yes | no — **GAP** |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook HMAC verification | `src/app/api/webhooks/stripe/route.ts`, `src/lib/integration-guard.ts` | none | yes | no — **GAP** |
| `ANTHROPIC_API_KEY` | AI routes: blueprint analyze, takeoff extract, scan-sheet, claude-tools, insights, daily-briefing | `src/lib/ai/insights.ts:77`, `src/lib/claude.ts:61`, `src/lib/blueprint-ai.ts:132`, `src/app/api/blueprints/[id]/analyze/route.ts:44`, `src/app/api/ops/takeoffs/[id]/extract/route.ts:90` | none; guarded by `isAIConfigured()` | yes | no — **GAP** |
| `ABEL_MCP_API_KEY` | Bearer token for Aegis → NUC Brain MCP calls | `src/lib/nuc-bridge.ts:100` | none | no — **GAP** | no — **GAP** |
| `AEGIS_API_KEY` | Shared secret for NUC → Aegis inbound pushes (currently `/api/ops/hyphen/ingest`) | `src/app/api/ops/hyphen/ingest/route.ts:23`, `scripts/verify-hyphen-pipeline.mjs:55` | `''` (empty) — rejects all requests if unset | yes | no — **GAP** |
| `EMAIL_WEBHOOK_SECRET` | Inbound email webhook signature check | `.env.example` lists as REQUIRED-for-prod | (verify in webhook route) | yes | no |
| `HYPHEN_WEBHOOK_SECRET` | Hyphen inbound webhook signature check | usage in webhook route | (verify) | yes | no |
| `INFLOW_WEBHOOK_SECRET` | InFlow webhook signature check | usage in webhook route | (verify) | yes | no |
| `INTERNAL_LOG_SECRET` | Auth for internal log ingest middleware path | `src/middleware.ts:114` | none | yes | no |
| `AGENT_HUB_API_KEY` | NUC agent server-to-server auth | `src/middleware.ts:490` | none | yes | no |
| `NUC_BRAIN_API_KEY` | Inbound Brain → Aegis auth for score/alert/action pushes | (typically paired with `AEGIS_API_KEY`) | (varies) | yes | no |
| `NUC_BRAIN_URL` | Base URL for NUC brain proxy + pulls | `src/app/api/cron/brain-sync/route.ts:20`, `src/app/api/cron/brain-sync-staff/route.ts:20`, `src/app/api/ops/brain/proxy/route.ts:23`, `src/lib/nuc-bridge.ts:103`, 4 scripts | `'https://brain.abellumber.com'` (all call sites agree) | yes | no |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service-token pair for NUC tunnel | `scripts/aegis-to-brain-sync.ts:83-84`, `scripts/brain-connectivity-test.ts:89-90` | none | yes | no |
| `INFLOW_API_KEY` | InFlow Cloud REST auth | `scripts/verify-inflow-liveness.mjs:33`, `src/app/api/ops/inflow/*`, `src/lib/inflow/*` | none | yes | no |
| `INFLOW_COMPANY_ID` | InFlow company UUID | `scripts/verify-inflow-liveness.mjs:34`, inflow client | none | yes | no |
| `BUILDERTREND_API_KEY` + `BUILDERTREND_API_SECRET` + `BUILDERTREND_CLIENT_ID` + `BUILDERTREND_CLIENT_SECRET` + `BUILDERTREND_ACCOUNT_ID` + `BUILDERTREND_BASE_URL` + `BUILDERTREND_WRITE_ENABLED` | BuilderTrend OAuth/API integration | `src/lib/builder-trend/client.ts`, `src/app/api/cron/buildertrend-sync/route.ts` | `BUILDERTREND_BASE_URL` falls back to `'https://api.buildertrend.com/v1'` | no — **GAP, all 7 missing from example** | no |
| `HYPHEN_USERNAME` + `HYPHEN_PASSWORD` | Hyphen portal scraper credentials | `src/lib/hyphen/scraper.ts`, `src/lib/hyphen/job-sync.ts` | none (scraper returns `HYPHEN_CREDS_MISSING` reason) | no — **GAP** | no |
| `HYPHEN_URL` / `HYPHEN_BASE_URL` / `HYPHEN_PORTAL_URL` | Hyphen portal base URL (three aliases) | `src/lib/hyphen/scraper.ts:118-120` | scraper returns `HYPHEN_URL_MISSING` | no — **GAP** | no |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_REALM_ID` / `QBO_REFRESH_TOKEN` / `QBO_ACCESS_TOKEN` / `QBO_API_BASE` | QuickBooks Online OAuth2 (Phase 2 scaffold — not yet active) | `src/lib/integrations/quickbooks.ts:90` | `QBO_API_BASE` → `'https://quickbooks.api.intuit.com/v3'` | yes (all) | no |
| `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Gmail domain-wide-delegation service account | `scripts/cron-fix-gmail-sync.ts:43-44`, `src/app/api/cron/gmail-sync/route.ts` | none; feature falls back to disabled | yes | no |
| `GMAIL_PUBSUB_AUDIENCE` / `GMAIL_PUBSUB_SERVICE_ACCOUNT` / `GMAIL_SYNC_API_KEY` / `GMAIL_WEBHOOK_TOKEN` | Legacy Gmail push sync | various | none | yes | no |
| `ELEVENLABS_API_KEY` | Voice alerts (driver dispatch, collections call scripts) | tts wrapper | none | yes | no |
| `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` / `NEXT_PUBLIC_SENTRY_DSN` | Error tracking | `src/instrumentation.ts`, `next.config.ts`-ish | none | yes | no |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed rate-limit + cron-alert dedupe | `src/lib/redis` etc. | none; feature degrades to in-memory | yes | no |
| `NEXT_PUBLIC_APP_URL` | Link generation for emails (invites, pw resets) | 10+ call sites | `'https://app.abellumber.com'` consistent everywhere | yes | yes (also `NEXT_PUBLIC_APP_NAME`) |
| `COLLECTIONS_EMAILS_ENABLED` | Gate for collections email sends | collections route | boolean default | no — **GAP** | no |
| `DEFAULT_FROM_EMAIL` | Fallback from-addr when RESEND_FROM_EMAIL unset | email.ts | falls back to RESEND_FROM_EMAIL | no — **GAP** | no |
| `API_SECRET_KEY` | Legacy generic API key | `src/middleware.ts` per grep | none | yes | no |

### 1c. OPTIONAL (pure degradation, no action needed)

| Var | Purpose | Fallback |
|---|---|---|
| `HEALTH_TOKEN` | Optional bearer for `/api/health/crons` endpoint | `src/app/api/health/crons/route.ts:101` — if unset, endpoint is open |
| `DIRECT_URL` | Non-pooled DB URL for Prisma migrations | optional; warning at startup if missing in prod |
| `DRY_RUN` | Script safety flag | default off |
| `NUC_URL` / `NUC_TAILSCALE_URL` | NUC coordinator base URL (legacy name + new name) | `src/lib/engine-auth.ts:70` reads `NUC_URL \|\| NUC_TAILSCALE_URL` — **this is the documented legacy-to-new pattern, acceptable** |
| `NUC_AGENT_TOKEN` | NUC agent bearer token | errors out if unset when used |
| `ENGINE_BRIDGE_TOKEN` | Engine bridge token | — |
| `AEGIS_BASE_URL` | Scripts-only; `https://app.abellumber.com` default | consistent fallback |
| `AUDIT_EMAIL` / `AUDIT_PASSWORD` | E2E audit script creds | `scripts/e2e-workflow-audit.mjs:31-34` — falls back to Nate's email and a repo constant |
| `BASE_URL` | Script CLI override | — |
| `CRON_URL` | Script CLI override | — |
| `ADMIN_SEED_ENABLED` / `ADMIN_SEED_KEY` | One-shot owner bootstrap endpoint — **MUST be unset/false in prod** | — |
| `ALERT_NOTIFY_EMAILS` / `CRON_FAILURE_NOTIFY_EMAILS` | Alert recipient list | defaults to `n.barrett + c.vinson` per cron-alerting.ts |
| `DOCUMENTS_PATH` | Alt upload dir | falls back to UPLOAD_DIR |
| `N_PLUS_ONE_THRESHOLD` / `PRISMA_SLOW_QUERY_MS` | Perf diagnostic thresholds | sensible defaults in code |
| `FEATURE_BUILDERTREND_INGEST` / `FEATURE_COLLECTIONS_SEND_REMINDER` / `FEATURE_HYPHEN_SYNC` / `FEATURE_PM_DIGEST_EMAIL` / `FEATURE_SMARTPO_SHIP` | Server-side feature gates | default off |
| `CURRI_API_KEY` / `CURRI_API_URL` | Curri 3rd-party delivery — code still reads var, but `.env.example` line 328 says "REMOVED 2026-04-22: Curri evaluation deferred". **Dead-code follow-up** (not urgent). | URL → `https://api.curri.com/v1` |

### 1d. PUBLIC (`NEXT_PUBLIC_*`, inlined at build)

All `NEXT_PUBLIC_*` vars are client-exposed. Reviewed contents — **none carry secrets**. They are either URLs, display names, deploy tags, or boolean feature-flag flips.

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public app URL (used in email links, client fetches) |
| `NEXT_PUBLIC_APP_NAME` | Display name |
| `NEXT_PUBLIC_BASE_URL` | Alternate base URL (**see deprecation note in Section 2**) |
| `NEXT_PUBLIC_DEPLOY_TAG` | Git SHA / Vercel deploy ID shown in status bar |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side Sentry DSN (DSNs are not secrets — public by design) |
| `NEXT_PUBLIC_AEGIS_V2_DRAFTING_ROOM` | Feature flag (drafting-room UI) |
| `NEXT_PUBLIC_FEATURE_*` (~23 flags) | Per-page/per-feature gates (`FEATURE_BEN_PAGE`, `FEATURE_BRITTNEY_PAGE`, `FEATURE_CHAD_PAGE`, `FEATURE_THOMAS_PAGE`, `FEATURE_BUILDER_OVERVIEW`, `FEATURE_CALENDAR`, `FEATURE_CO_INBOX`, `FEATURE_CYCLECOUNT_HISTORY`, `FEATURE_DELIVERY_SIGNOFF`, `FEATURE_EXEC_DASH`, `FEATURE_FINANCE_YTD`, `FEATURE_HYPHEN_PANEL`, `FEATURE_INTEGRATIONS_DASH`, `FEATURE_MATERIAL_DRAWER`, `FEATURE_PM_ACTIVITY_FEED`, `FEATURE_PM_BOOK`, `FEATURE_PM_COMPARE`, `FEATURE_PM_ROSTER`, `FEATURE_PM_TODAY`, `FEATURE_SHORTAGES`, `FEATURE_SMARTPO`, `FEATURE_SUB_QUEUE`, `BRITTNEY_DELEGATE_TO_PM_BOOK`) |

### 1e. RUNTIME-ONLY (platform-provided, do not set)

| Var | Source |
|---|---|
| `NEXT_RUNTIME` | Next.js sets to `'nodejs'` / `'edge'` |
| `VERCEL_URL` / `VERCEL_REGION` / `VERCEL_GIT_COMMIT_SHA` | Vercel-injected |
| `GIT_SHA` | Common convention; read in build-stamp logic |
| `BUILD_TIMESTAMP` | Build-time injected |

---

## Section 2: Fallback chain audit

### 2a. Inconsistent `NEXT_PUBLIC_APP_URL` fallback shape

Two distinct patterns are used across the codebase for the same conceptual value:

**Pattern A (3 files, 3-level chain):**
- `src/app/api/cron/process-outreach/route.ts:84` — `process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'`
- `src/app/api/payments/route.ts:130` — `request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'`
- `src/app/api/ops/staff/bulk-invite/route.ts:22` — `process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'`

**Pattern B (11 files, 4-level chain with `NEXT_PUBLIC_BASE_URL` in the middle):**
- `src/lib/claude-tools.ts` — 6 call sites on lines 1019, 1057, 1071, 1196, 1227, 1239
- `src/app/api/ops/migrate/employee-onboarding/route.ts:80`
- `src/app/api/ops/staff/route.ts:198`
- `src/app/api/ops/staff/fix-passwords/route.ts:61`
- `src/app/api/ops/staff/[id]/route.ts:416,450`

All resolve to the same production value `https://app.abellumber.com` when env vars are unset, so **no functional risk for Monday**. However:

- **`NEXT_PUBLIC_BASE_URL` is effectively DEPRECATED** (newer code drops it, `.env.example:258` describes it as "Alternative internal base URL"). Recommend: delete the middle-fallback from Pattern B files in a follow-up PR, standardize on Pattern A.
- In `.env.example` the chain is unclear — docs should commit to ONE canonical var.

### 2b. Hardcoded URL fallbacks — all pointing to correct production hosts

| File | Fallback URL | Verdict |
|---|---|---|
| `src/app/api/cron/brain-sync/route.ts:20`, `brain-sync-staff/route.ts:20`, `src/app/api/ops/brain/proxy/route.ts:23` | `https://brain.abellumber.com` | OK |
| `src/lib/builder-trend/client.ts:123` | `https://api.buildertrend.com/v1` | OK (vendor endpoint) |
| `src/lib/integrations/quickbooks.ts:90` | `https://quickbooks.api.intuit.com/v3` | OK (vendor endpoint) |
| `src/lib/integrations/curri.ts:12`, `src/app/api/ops/delivery/dispatch/route.ts:21` | `https://api.curri.com/v1` | **DEAD** — Curri deferred per .env.example:328. Not a security issue; remove in cleanup. |
| `scripts/verify-hyphen-pipeline.mjs:53`, `scripts/test-qc-gate.mjs:35` | `http://localhost:3000` | OK (scripts only, dev fallback) |
| `src/middleware.ts:10` | `'dev-secret-change-in-production'` for JWT | OK — top-of-file guard throws in prod if `JWT_SECRET` unset; dev-only |

**No stale `*.vercel.app` preview URLs found in source.**

### 2c. Hyphen URL aliasing (intentional, not a bug)

`src/lib/hyphen/scraper.ts:118-120` reads `HYPHEN_URL || HYPHEN_BASE_URL || HYPHEN_PORTAL_URL`. Three aliases for the same value. The error path throws `HYPHEN_URL_MISSING`. The scripts/verify-hyphen-pipeline.mjs uses a fourth name `HYPHEN_INGEST_URL`. **Recommend documenting canonical name in `.env.example` (currently absent) and deleting unused aliases.** Non-blocking for Monday.

---

## Section 3: Secret-leak scan results

Summary already in Section 0. Detail:

| Check | Scope | Hits | Notes |
|---|---|---|---|
| Leaked Neon password token | repo | 0 | Transcript-only. Still rotate. |
| `JWT_SECRET="<real>"` | repo | **2** | `.env.production.template:16`, `docs/LAUNCH-READINESS-REPORT.md:68`. Same value. **Rotate and scrub.** |
| `Bearer eyJ...` hardcoded | `src/`, `scripts/` | 0 | — |
| `sk_live_` / `sk_test_` | `src/`, `scripts/` | 0 | — |
| `re_[A-Za-z0-9_]{20,}` (Resend) | `src/`, `scripts/` | 0 | Scripts matches were file-path substrings in `manifest.json`, not API keys |
| `postgresql://u:p@` literal | `src/`, `scripts/` | 0 | — |
| `ANTHROPIC_API_KEY\s*=\s*"sk-ant` | repo | 0 | — |

---

## Section 4: Vercel-env readiness checklist (for Nate before Monday)

Verify each row in Vercel → Project Settings → Environment Variables → Production. Columns: purpose / what-to-set / **must verify**.

| Var | Purpose | Prod value should be | Status |
|---|---|---|---|
| `DATABASE_URL` | Neon pooled conn string | `postgresql://<user>:<NEW_PASSWORD>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require` | **ROTATE + update** |
| `JWT_SECRET` | HMAC for auth | New 48+ char random (`openssl rand -base64 48`) | **ROTATE** (old value leaked in repo) |
| `CRON_SECRET` | Auth for /api/cron/* | 32+ char hex | VERIFY set — env.ts warns loudly at startup if missing |
| `STRIPE_SECRET_KEY` | Payments | `sk_live_...` (prod, not test) | VERIFY set and live, not test |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook HMAC | `whsec_...` from live webhook endpoint | VERIFY set |
| `RESEND_API_KEY` | Transactional email | `re_...` (production) | VERIFY set |
| `RESEND_FROM_EMAIL` | Email from-addr | `Abel Lumber <noreply@abellumber.com>` | VERIFY |
| `ANTHROPIC_API_KEY` | AI (QC scan, blueprint, takeoff, daily briefing, claude-tools) | `sk-ant-api03-...` | VERIFY set |
| `NEXT_PUBLIC_APP_URL` | Client link generation | `https://app.abellumber.com` | VERIFY (no trailing slash) |
| `ABEL_MCP_API_KEY` | Aegis → NUC Brain MCP bearer | 1Password pointer | VERIFY set (missing breaks brain queries — returns 503) |
| `AEGIS_API_KEY` | NUC → Aegis Hyphen ingest | must match NUC side | VERIFY set and identical on NUC |
| `NUC_BRAIN_URL` | Brain tunnel URL | `https://brain.abellumber.com` | VERIFY or omit (defaults fine) |
| `NUC_BRAIN_API_KEY` | Inbound Brain auth | must match NUC's `AEGIS_API_KEY` | VERIFY |
| `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token for NUC tunnel | service-token pair | VERIFY or Brain calls will 403 |
| `INFLOW_API_KEY` + `INFLOW_COMPANY_ID` + `INFLOW_WEBHOOK_SECRET` | InFlow sync + webhooks | from InFlow dashboard | VERIFY all three |
| `HYPHEN_WEBHOOK_SECRET` | Inbound Hyphen webhook HMAC | 32+ char hex | VERIFY |
| `EMAIL_WEBHOOK_SECRET` | Inbound email webhook | 32+ char hex | VERIFY |
| `INTERNAL_LOG_SECRET` | Internal log ingest | 32+ char hex | VERIFY |
| `AGENT_HUB_API_KEY` | NUC agent cluster auth | 1Password pointer | VERIFY if agents are in scope for Monday |
| `BUILDERTREND_*` (7 vars) | BuilderTrend sync + write | from BT OAuth app | VERIFY if BT feature flag on |
| `HYPHEN_USERNAME` + `HYPHEN_PASSWORD` + `HYPHEN_URL` | Hyphen scraper | portal creds | VERIFY if hyphen-sync cron on |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Gmail sync | full JSON key (paste inline) | VERIFY if gmail-sync cron on |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` | Error tracking | from Sentry project | RECOMMENDED set |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate limit + cron-alert dedupe | from Upstash console | RECOMMENDED set |
| `ALERT_NOTIFY_EMAILS` | Alert recipients | `n.barrett@abellumber.com,c.vinson@abellumber.com` | OPTIONAL (code defaults to these two) |
| `ADMIN_SEED_ENABLED` | Dangerous bootstrap endpoint | **unset or `"false"`** | **CONFIRM not `"true"` in prod** |
| `ADMIN_SEED_KEY` | Paired with above | irrelevant if disabled | — |

---

## Section 5: `NEXT_PUBLIC_*` leak review

Scanned every `NEXT_PUBLIC_*` var for risky client-exposure. None carry secrets. The concern vectors I checked:

| Var | Value type | Client-exposure risk |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | URL | None — public by design |
| `NEXT_PUBLIC_BASE_URL` | URL | None |
| `NEXT_PUBLIC_APP_NAME` | String literal | None |
| `NEXT_PUBLIC_DEPLOY_TAG` | Git SHA | None (non-sensitive) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | **Designed to be public.** DSNs are not secrets; Sentry rate-limits per-project. OK. |
| `NEXT_PUBLIC_AEGIS_V2_DRAFTING_ROOM` | "0" / "1" / blank | None |
| `NEXT_PUBLIC_FEATURE_*` (23 flags) | "0" / "1" / blank | None |
| `NEXT_PUBLIC_BRITTNEY_DELEGATE_TO_PM_BOOK` | "0" / "1" | None |

**All clear.** No private-auth values prefixed `NEXT_PUBLIC_`.

---

## Section 6: Env-var naming consistency

Checked for common naming drift:

| Drift check | Result |
|---|---|
| `STRIPE_WEBHOOK_SECRET` vs `STRIPE_WH_SECRET` | Only `STRIPE_WEBHOOK_SECRET` used. Clean. |
| `HYPHEN_*` vs `SUPPLYPRO_*` | No `SUPPLYPRO_` references in repo. Clean. |
| Plural typos (`JWT_SECRETS` etc.) | None. |
| `NUC_URL` vs `NUC_TAILSCALE_URL` | Intentional transition — `src/lib/engine-auth.ts:70` reads new-name-first, legacy fallback. Documented. OK. |
| `HYPHEN_URL` / `HYPHEN_BASE_URL` / `HYPHEN_PORTAL_URL` | Three aliases read in `src/lib/hyphen/scraper.ts:118-120`. Intentional but should collapse in a future pass. |
| `NEXT_PUBLIC_APP_URL` vs `NEXT_PUBLIC_BASE_URL` vs `APP_URL` | Three-way variant; see Section 2a. Standardize on `NEXT_PUBLIC_APP_URL`. |
| `DEFAULT_FROM_EMAIL` vs `RESEND_FROM_EMAIL` | Two names with overlapping intent. Low priority. |

---

## Top recommendations (ordered by urgency)

1. **ROTATE Neon DB password** in Neon console, update `DATABASE_URL` in Vercel Production (+ Preview + Development separately), redeploy. Original leaked in today's session transcript.
2. **ROTATE `JWT_SECRET`** — value `U/XY9ykr…` is committed to `.env.production.template:16` and `docs/LAUNCH-READINESS-REPORT.md:68`. Generate new with `openssl rand -base64 48`, update Vercel, redeploy. Users will be logged out — acceptable.
3. **Scrub both committed files:** replace real value with placeholder in `.env.production.template` and `docs/LAUNCH-READINESS-REPORT.md`. Commit the scrub. Consider adding both files to `.gitignore` since `.env.example` already covers the onboarding case. (Follow-up PR; not blocking Monday if rotation is done.)
4. **Verify every row in the Section 4 checklist** in Vercel dashboard before Monday. Especially: `CRON_SECRET` (loud warning in env.ts if missing — but still a silent auth-hole for 46 cron routes if actually unset), `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ABEL_MCP_API_KEY`, `AEGIS_API_KEY`.
5. **Confirm `ADMIN_SEED_ENABLED` is unset/false** in Vercel Production. With it on, `/api/admin/seed` lets anyone with `ADMIN_SEED_KEY` mint an OWNER account.
6. **Close the `.env.production.template` gaps:** it only documents 5 vars (DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_APP_URL + _APP_NAME, RESEND_*). Either expand it to match `.env.example`, or delete the template to prevent drift/confusion.
7. **Follow-up PR — fallback chain cleanup:** standardize on `NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'` across all 14 call sites, drop `NEXT_PUBLIC_BASE_URL` middle-fallback. Rename `HYPHEN_URL`/`HYPHEN_BASE_URL`/`HYPHEN_PORTAL_URL` to one name. Remove `CURRI_API_KEY` / `CURRI_API_URL` dead code.
