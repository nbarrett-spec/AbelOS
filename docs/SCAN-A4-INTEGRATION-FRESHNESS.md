# SCAN-A4 — Integration Freshness Audit

**Generated:** 2026-04-27 ~15:32 UTC | **HEAD:** `171a6b4` | **Mode:** READ-ONLY

Probed prod Neon directly. Counts/timestamps below are exact at probe time.

## Cron health (last 7d, ranked by failure count)

| Cron | Runs | OK | Failed | Last run | Note |
|---|---|---|---|---|---|
| `gmail-sync` | 426 | 305 | **121** | 04-27 15:30 | row-level OK, batch-level FAILURE on CC escape |
| `inflow-sync` | 379 | 321 | 57 | 04-27 15:30 | actively syncing |
| `aegis-brain-sync` | 98 | 54 | **44** | 04-27 15:00 | HTTP 401 every run, 0/31 sent |
| `brain-sync` | 29 | 13 | 16 | 04-27 12:00 | |
| `brain-sync-staff` | 27 | 16 | 11 | 04-27 12:00 | |
| `bpw-sync` | 12 | 0 | **12** | 04-21 02:45 | stopped (Pulte lost) |
| `bolt-sync` | 11 | 0 | 11 | 04-21 02:30 | stopped (legacy ERP) |
| `hyphen-sync` | 109 | 98 | 11 | 04-27 15:15 | "lies about SUCCESS" — skipping |
| `financial-snapshot` | 6 | 0 | 6 | 04-27 06:00 | out of scope here |
| `brain-synthesize` | 3 | 0 | 3 | 04-27 06:00 | |
| `buildertrend-sync` | 56 | 56 | 0 | 04-27 14:15 | clean skip — gold standard |

---

### [P0] Hyphen: NO CONFIG ROW IN DB — cron lies about SUCCESS (confirmed)
**Last ingest:** Never via the cron. `HyphenDocument` 0 rows. `HyphenOrderEvent` 0. `HyphenAccessToken` 0. `HyphenCredential` 0. Last `HyphenOrder` row 2026-04-11 14:55 (16d, manual import); 0 rows in last 24h or 7d.
**Health:** RED. Expected hourly, getting nothing.
**Issue:** Last 8 hyphen-sync runs all `status=SUCCESS` with `result.skipped=true, reason=NO_HYPHEN_CONFIG`. The cron short-circuits because no `IntegrationConfig` row has `provider=HYPHEN` (verified — distinct providers in DB: `BOISE_CASCADE`, `BUILDERTREND`, `INFLOW`, `QUICKBOOKS_DESKTOP`). The `/admin/crons` dashboard shows green; reality is no data flowing.
**Fix:**
1. Insert `IntegrationConfig` row `provider='HYPHEN', status='CONNECTED', apiKey=<token>, baseUrl=<endpoint>`. Handler at `src/app/api/cron/hyphen-sync/route.ts:31-37` is already defensive against partial config.
2. Change skip-path status from `SUCCESS` to `SKIPPED`, or have `/ops/crons` colour `result.skipped=true` distinctly. Right now dashboards can't tell "ran cleanly" from "didn't run because creds missing."
3. This is the smoking gun behind CLAUDE.md's "Brookfield Hyphen 0/80 linked".

---

### [P0] Stripe: 0 webhook events ever; payments path uses CHECK/ACH only
**Last ingest:** `WebhookEvent` table has **0 rows total** (no provider has ever written there). Latest `Payment.receivedAt` 2026-03-27 — **31.5 days stale, confirms audit-data flag**.
**Health:** RED.
**Volume:** 0 webhooks ever. 45 `Payment` rows in last 32d (all CHECK/WIRE/ACH, **0 CREDIT_CARD ever** in 4,602 historical rows). 4,124 `Invoice` rows, **0** with `stripeSessionId`.
**Issue:** Two distinct problems:
1. `/api/webhooks/stripe` route exists, but no event has ever landed. Either the webhook URL isn't registered in the Stripe dashboard, or `STRIPE_WEBHOOK_SECRET` is unset/wrong in Vercel so verification rejects every call. Cannot verify Stripe dashboard from here.
2. Stripe payment-link generation is also unused — `Invoice.stripeSessionId/stripeCustomerId/stripePaymentUrl` are dead schema columns at present.
**Fix:** Decide whether Stripe is live. If yes: register `https://app.abellumber.com/api/webhooks/stripe` in the Stripe dashboard, set `STRIPE_WEBHOOK_SECRET` in Vercel, fire a test event. If no (current revenue is 100% check/ACH/wire, which the data confirms), flag the Stripe schema columns and webhook route for SCAN-A1 dead-code review.

---

### [P0] Gmail Push: rows succeed but cron logs FAILURE — Pulte fix incomplete
**Last ingest:** 2026-04-27 15:22 (~12 min ago at probe time). 312 Gmail rows in last 24h, 2,351 in 7d. **All 312 last-24h rows have status=SYNCED — 0 row-level errors.**
**Health:** YELLOW. ~13 emails/hr, healthy cadence.
**Issue:** Cron outcome disagrees with row-level health: 121 of 426 runs FAILED (28%) in 7d. Last 5 runs alternate FAILURE / SUCCESS. Cause: `prisma.$executeRawUnsafe ... ERROR: malformed array literal: "{""fer..."` — Postgres array-literal parse error inserting `ccAddresses`/`toAddresses` (`String[]` cols). **The Pulte CC quote-escape fix mentioned in mission did not fully land** — single-message failures (e.g. message `19dcf640ffe7560a` for chad.zeh@) still bubble as 500 in the loop and trip FAILURE, but most messages in the same batch did sync. So this is a partial bleed, not an outage. A few specific Gmail messages fail forever (likely Pulte-pattern threads).
**Fix:** Capture a failing payload from cron result JSON (msg ID is logged). The `{""fer...` prefix suggests a CC field with quoted display name like `"fernando ..."` is double-escaped during raw-SQL build. Convert that raw-SQL `INSERT` to `prisma.communicationLog.create()` — Prisma's array binding handles quoting correctly.

---

### [P0] BPW (Pulte portal): broken since deploy + should be killed
**Last ingest:** Never via cron. `BpwInvoice`, `BpwFieldPO`, `BpwCheck`, `BpwCommunity`, `BpwJobDetail` all **0 rows**. (Sibling family `Bwp*` — different prefix — has 4,020 invoices from a one-off historical import; last `createdAt` 2026-04-11.)
**Health:** RED + dead.
**Issue:** Last 12 runs (04-20 21:45 → 04-21 02:45) all FAILED with `IntegrationConfig.findUnique({ provider: "BPW_PULTE" }) — Invalid value`. The `IntegrationProvider` enum allows `INFLOW | ECI_BOLT | GMAIL | HYPHEN | QUICKBOOKS_DESKTOP | BUILDERTREND` — `BPW_PULTE` is not in it. So this cron has failed every invocation since deploy, then **stopped running entirely on 2026-04-21** (cron likely removed from `vercel.json` the day after Pulte was lost).
**Fix:** Pulte is gone (per CLAUDE.md, account closed 2026-04-20). Delete `src/app/api/cron/bpw-sync/`, `src/app/api/ops/import-bpw/`, `src/lib/integrations/bpw.ts`. Verify the `bpw-sync` schedule is already gone from `vercel.json`. Flag `Bpw*` (empty) tables for SCAN-A1 dead-model removal; archive `Bwp*` (4,020 invoices) — historical Pulte data has business value.

---

### [P0] NUC Brain ingest: HTTP 401 every run for 8+ hours
**Last ingest:** Cron runs hourly but every batch hits `HTTP 401 authentication required` from `brain.abellumber.com`. Last 8 consecutive runs all FAILED with `sent 0/31` (or 0/32). Events pile up un-ack'd; backfill possible only within 65-min lookback. `EngineSnapshot` 0 rows.
**Health:** RED.
**Issue:** `cfAuth: ok` flag in result indicates Cloudflare service-token handshake passes, but the upstream Brain endpoint rejects with the human-facing `/login` redirect. Commits `fa79594` (X-API-Key dual-send) and `1f6fc64` were trying to fix exactly this. **The fix is in HEAD but is not working** — Brain is still demanding interactive login. Either the Brain-side API key is wrong/unset, or Brain matches auth on a different header than what Aegis sends.
**Fix:** Compare actual outbound headers in `scripts/aegis-to-brain-sync.ts` vs what Brain expects. CLAUDE.md says Brain MCP layer expects `Bearer ABEL_MCP_API_KEY`; the FastAPI `/brain/ingest/batch` engine endpoint may want a different header. Verify the env var Aegis reads (likely `BRAIN_API_KEY`) is set in Vercel and matches what Brain has registered.

---

### [P0] NUC Heartbeat: 0 rows ever
**Last ingest:** Never. `NucHeartbeat` table empty.
**Health:** RED, but not an Aegis bug — coordinator NUC at `100.84.113.47` hasn't started pushing yet. Consistent with CLAUDE.md "engine code is done — waiting on Nate to physically deploy to NUC hardware."
**Fix:** No fix on platform side; the heartbeat endpoint is a no-op until the NUC posts.

---

### [P1] InFlow: working, healthy ingest — but dashboard misreports
**Last ingest:** 2026-04-27 15:30 (just now). `IntegrationConfig` `CONNECTED, syncEnabled=true, syncInterval=300s`. `lastSyncAt` field on the config row is stale (2026-04-22 15:30, 5 days old) but `SyncLog` proves continuous activity.
**Health:** GREEN for ingest, YELLOW for the dashboard signal.
**Volume:** Last 8 SyncLog rows: salesOrders 500, purchaseOrders 500, inventory 6,000 — all `status=SUCCESS, recordsFailed=0`. Cron runs every 15 min in practice.
**Issue:** 57 of 379 runs failed in 7d (15%) but no failures in the most recent 6. `IntegrationConfig.lastSyncAt` is not being bumped by the cron — it writes `SyncLog` rows but doesn't update the parent config. So `/ops/integrations` shows "last synced 5 days ago" while data is actually flowing every 15 min.
**Fix:** In `src/app/api/cron/inflow-sync/route.ts` (or `lib/integrations/inflow.ts`), `prisma.integrationConfig.update({ where:{provider:'INFLOW'}, data:{lastSyncAt: new Date(), lastSyncStatus:'success'} })` after a successful run. Investigate the 15% historical failure rate via `SyncLog.errorMessage` distribution.

---

### [P1] Resend: not in use via EmailQueue path
**Last ingest:** `EmailQueue` table **0 rows**.
**Health:** YELLOW (ambiguous — not dead, not used here).
**Volume:** 1,634 OUTBOUND `CommunicationLog.channel=EMAIL` rows in 7d, last `createdAt` 2026-04-27 15:22 — email **is** being sent and logged, just not through `EmailQueue`. Code referencing `EmailQueue`: `src/lib/notifications.ts`, `src/lib/workflows.ts`, `src/app/api/ops/email/route.ts`, `src/app/api/ops/sales/migrate/route.ts`, `src/app/api/ops/notifications/builder/route.ts`.
**Issue:** Two-track email system. Direct sends via `src/lib/email.ts` → Resend → log to `CommunicationLog`. The `EmailQueue` table was for delayed/retry sends but has zero usage. Either the queue is dead code, or the writers above are silently failing to insert.
**Fix:** Verify `RESEND_API_KEY` is set in Vercel (manual check). Audit one queue writer (`lib/notifications.ts`) and confirm its code path is actually reached. If unreachable, mark `EmailQueue` for SCAN-A1 dead-model removal. No FAILED rows to worry about — there are no rows.

---

### [P2] QuickBooks: STUB only — confirmed
`IntegrationConfig` row `provider=QUICKBOOKS_DESKTOP, status=PENDING, syncEnabled=false`. `QBSyncQueue` 0 rows. No `qb-sync` cron entry. Flag for kill/build decision (out of scope here).

### [P2] BuilderTrend: not configured (clean skip — gold standard)
`IntegrationConfig` `PENDING, syncEnabled=false`. Last 4 runs all log `status=SUCCESS, result.skipped=true, reason=not_configured` with a clear message. **This is the right pattern for the Hyphen cron to copy.** `BTProjectMapping` 0 rows, expected.

### Other
- **Bolt (legacy ERP):** `bolt-sync` 11 fail / 0 ok in 7d, **stopped 2026-04-21** alongside `bpw-sync`. Same kill recommendation.
- **Boise Cascade:** Placeholder `IntegrationConfig` row, no cron, no model.
- **Curri / ShipStation:** No models, no env, no routes. Not integrated.

---

## P0 must-fix (5)
1. Brain ingest auth (HTTP 401 every hour, 0/31 sent — fix in HEAD didn't work)
2. Hyphen integration config row missing — cron silently skips while logging SUCCESS
3. Stripe webhook never fired — verify dashboard registration vs kill the integration
4. Gmail-sync `ccAddresses` array-literal escape regression — switch raw SQL to Prisma
5. NUC heartbeat empty — track separately (waiting on hardware deploy, not an Aegis bug)

## P1 cleanup (3)
6. InFlow `IntegrationConfig.lastSyncAt` not bumped on success — dashboard misreports
7. Kill BPW + Bolt cron + models (Pulte gone 2026-04-20; both crons hard-stopped 2026-04-21)
8. EmailQueue table dead — pick a path (use it or drop the model)

## P2 / observation
9. The "lies about SUCCESS" pattern bites multiple crons. Make `result.skipped=true` render distinctly on `/ops/crons` so partial-config integrations stop hiding behind green dots.
