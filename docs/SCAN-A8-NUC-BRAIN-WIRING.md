# SCAN-A8 — NUC Heartbeat & Brain Ingest Wiring

**HEAD:** 171a6b4 · **Date:** 2026-04-27 · **Mode:** read-only

## Status: red

Coordinator NUC has **never sent a heartbeat** (zero rows in `NucHeartbeat`,
ever). Aegis → Brain ingest cron has been **failing every hour since
2026-04-25 20:00 UTC** (~44 consecutive failures, ~1.8 days dark) with HTTP
401 from `brain.abellumber.com/brain/ingest/batch`. The daily Brain
synthesize cron has the same auth break (last clean run: never; the partial
run on 2026-04-25 06:00 succeeded ingest+polish then 504'd on narrate).
Result: Aegis dashboard shows the NUC engine as offline, and no live business
data has reached the Brain since launch + 12 days.

## Heartbeat

- **Last received:** never. `SELECT COUNT(*) FROM "NucHeartbeat"` = 0.
- **Coordinator NUC:** has never POSTed `/api/v1/engine/heartbeat`. Either
  the heartbeat cron isn't running on the NUC, or it's running but never
  authenticating successfully (Aegis would log nothing on a 401 since the
  request never reaches Prisma).
- **Worker NUCs:** all four (SALES / MARKETING / OPS / CUSTOMER_SUCCESS) are
  silent — consistent with CLAUDE.md "built but not yet provisioned." No
  features keyed to worker presence will ever light up.
- **Module status:** N/A — nothing to report.

## Brain ingest

- **Last successful `aegis-brain-sync` cron run:** 2026-04-25 19:00 UTC.
  Sent 31 events (30 `order_placed` + 1 `order_delivered`).
- **First failure:** 2026-04-25 20:00 UTC. Same payload, same auth headers
  in code, but Brain returned `401 {"error":"authentication required",
  "login_url":"/login"}` — i.e. **CF Access started rejecting the service
  token, or the Brain rotated its `AUTH_API_KEY` and the Vercel
  `BRAIN_API_KEY` env wasn't updated.** `report.cfAuth` field still reports
  `"ok"` (which only means the env vars are *present*, not that they work).
- **Failure count:** 44 FAILURE / 54 SUCCESS lifetime for `aegis-brain-sync`.
  Last 30 runs: 30 FAILURE.
- **Workspace ingester (`scripts/workspace-to-brain-ingest.ts`):** one-shot
  manual script; **no DB record of it ever running** (no CronRun rows
  for it, not registered in `vercel.json`). Posts to the same
  `/brain/ingest/batch` endpoint that's been 401'ing for two days, so any
  attempt to run it now would also fail.
- **`brain-synthesize` daily cron (06:00 UTC):** 3 FAILURE, 0 full SUCCESS.
  Same 401 root cause on the last two runs. Last partial: 2026-04-25 — got
  ingest+polish through, narrate timed out at 504.
- **Scheduled?** Yes, hourly for `aegis-brain-sync`, daily 06:00 UTC for
  `brain-synthesize` (`vercel.json`). `nuc-alerts` (every 6h) is a
  *different* cron — runs entirely inside Aegis and never touches the NUC,
  despite the name. It's been running and writing `NUC_*` InboxItem rows.
- **Stale-data signal to Aegis:** none. There is no `BrainSync` table or
  flag — Aegis only knows the *cron* failed, not whether the Brain is
  current. The Executive dashboard surfaces this only via NucStatusCard
  (which keys off `NucHeartbeat`, also empty). The CronRun failure is
  visible if someone opens the cron dashboard.

## MCP tool usage

- **Aegis routes calling NUC MCP (port 8401):** none. `grep '8401'` returns
  zero hits in `src/`. Only matches are in `.claude/settings.local.json`
  (Claude Desktop allowlist) and `nuc-bridge.ts` header comment.
- **Aegis routes calling NUC FastAPI (port 8400) directly:** two —
  `/api/integrations/nuc/health` and `/api/integrations/nuc/query`. Both go
  through `src/lib/nuc-bridge.ts`, which uses `NUC_BRAIN_URL` (defaulting
  to `http://100.84.113.47:8400` Tailscale) with `ABEL_MCP_API_KEY` bearer.
  - On Vercel, `NUC_BRAIN_URL` is **not set** in `.env.vercel-pull`, so the
    bridge falls back to the Tailscale IP, which is unreachable → every
    call returns `NUC_UNREACHABLE`. `nucHealth()` already wraps this and
    returns `{ ok: false }` instead of throwing, so no UI crashes — but
    every staff visit to a page hitting these routes triggers a 5-second
    wasted timeout.
- **`nuc-alerts` cron:** does NOT touch the NUC despite the name; it's pure
  Aegis SQL → InboxItem.

## Engine token

- **Code references:** `src/lib/engine-auth.ts` reads
  `process.env.ENGINE_BRIDGE_TOKEN`. Confirmed used by all
  `/api/v1/engine/*` routes including `heartbeat`.
- **Verify implementation:** correct. `verifyEngineToken` fails closed when
  the env var is empty, requires `Authorization: Bearer <token>`,
  uses `crypto.timingSafeEqual` for constant-time comparison, returns a
  discriminated `{ ok, workspaceId, source }` shape. No bugs.
- **Vercel env:** `ENGINE_BRIDGE_TOKEN` is present in `.env.vercel-pull`
  (so it's set on Vercel). Cannot verify the NUC has the matching value.
- **Heartbeat upsert:** correct. Raw SQL `INSERT … ON CONFLICT (nodeId) DO
  UPDATE` writes every column the NUC sends, including `lastScanAt`,
  `moduleStatus` (jsonb), `latencyMs`, `errorCount`. No silent error
  paths — failures return 500. **Means: if heartbeats were arriving, we'd
  see them. The fact we see zero rows means none are being sent.**

## NucStatusCard rendering

`src/app/ops/executive/NucStatusCard.tsx` calls `/api/ops/nuc/status` on
mount + every 60s. Behavior:

- **No heartbeat rows:** `coordinator: null` → state = `offline` →
  badge `OFFLINE`, headline "Offline — no heartbeat received," detail
  "NUC brain engine has not reported in. Verify the heartbeat cron is
  running on the NUC coordinator." **Correct, no bug.**
- **Stale (`receivedAt` > 180s):** `isStale: true` → `offline`, headline
  shows minutes since last heartbeat. **Correct, no bug.**
- **Online with degraded module:** state = `degraded`. Correct.
- **Auth failure on the upstream `/api/ops/nuc/status` endpoint:** falls
  through to `fetchError` → state = `offline`, "Status check failed." OK.

No "Online when stale" rendering bug. The card is honest. **The current UI
state is, accurately, OFFLINE — every executive viewing the dashboard
sees a red NUC card right now.**

## Findings

### P0 — fix this week
- **[P0] Brain ingest auth broken since 2026-04-25 20:00 UTC** (HTTP 401).
  The `aegis-brain-sync` hourly cron and the `brain-synthesize` daily cron
  have both failed every run for ~1.8 days. Every customer order, delivery,
  PO, and inbox item logged in Aegis since then has *not* reached the
  Brain. Likely fix: rotate `BRAIN_API_KEY` on Vercel to match whatever
  the NUC's `AUTH_API_KEY` is, or restore the CF Access service-token if
  it was revoked. Note `report.cfAuth: "ok"` is misleading — it only
  asserts the env var is *present*, not that the Brain accepts it.
  *Files:* `scripts/aegis-to-brain-sync.ts`,
  `src/app/api/cron/aegis-brain-sync/route.ts`,
  `src/app/api/cron/brain-synthesize/route.ts`.
- **[P0] Coordinator NUC heartbeat has never been received.** Either the
  heartbeat cron has never been deployed to the NUC, or it's running but
  401-ing on `ENGINE_BRIDGE_TOKEN` mismatch. The endpoint, auth, schema,
  and upsert are all correct on the Aegis side — the silence is on the
  NUC side. Action: SSH to coordinator, check whether a cron / systemd
  timer is hitting `https://app.abellumber.com/api/v1/engine/heartbeat`
  every 60s, and what response it gets.

### P1 — wiring gaps surfaced by this audit
- **[P1] No P0/P1 alerting on cron failure.** 44 consecutive `aegis-brain-sync`
  failures over 1.8 days produced no email / Slack / inbox item. Should
  add: after N consecutive failures of the same cron, write a
  `BRAIN_INGEST_DOWN` InboxItem (high priority) so a stale Brain becomes
  visible to Nate the next time he opens ops.
- **[P1] Workspace → Brain ingester (`scripts/workspace-to-brain-ingest.ts`,
  commit 839b660 / 0cac4e3) has zero CronRun history.** It's a manual
  one-shot — no schedule, no record of ever running successfully. Even
  if Nate ran it locally with `--commit`, there's no DB trace and no way
  for Aegis to know whether the Brain has ever seen `memory/` or
  `brain/` files. Either schedule it weekly or add a "last run"
  registry so the dashboard can flag stale knowledge.
- **[P1] All four worker NUCs are dark.** Confirmed — no SALES / MARKETING
  / OPS / CUSTOMER_SUCCESS heartbeats ever. Any UI/feature keyed to
  worker presence will silently render zero. (CLAUDE.md flags this; just
  validating.)
- **[P1] `/api/integrations/nuc/health` and `/api/integrations/nuc/query`
  are dead from Vercel.** They graceful-degrade to `NUC_OFFLINE`, but each
  call wastes a 5s health-check timeout. Either gate behind a feature
  flag, switch to the `https://brain.abellumber.com` (CF tunnel) URL via
  `NUC_BRAIN_URL`, or remove the routes until the worker NUCs ship.

### P2 — code quality / completeness
- **[P2] `report.cfAuth` field in `aegis-brain-sync` is a presence check,
  not a verification.** Reads as "ok" while every batch 401s. Misleading
  in CronRun.result; rename to `cfAuthConfigured` or actually probe.
- **[P2] No `BrainSync` model.** Aegis cannot answer "when did the Brain
  last successfully ingest something?" — the only signal is rummaging
  through `CronRun` history. A small `BrainSync` model with
  `lastSuccessfulIngestAt`, `lastError`, `eventsSent24h` would let the
  Executive dashboard show a "Brain freshness" tile.
- **[P2] `nuc-alerts` cron name is misleading.** It runs entirely inside
  Aegis and writes `NUC_*` InboxItems but never touches the NUC. Worth a
  rename to `business-watchdogs` or similar so future Claude sessions
  don't mistake it for NUC-side work.
- **[P2] `nuc-bridge.ts` default base URL is the Tailscale IP** — always
  fails on Vercel. The CF tunnel hostname (`brain.abellumber.com`) exists
  and `forwardToNuc` in `engine-auth.ts` already supports it via
  `NUC_URL`. Make `NUC_BRAIN_URL` default to the CF tunnel, fall back
  to Tailscale.
