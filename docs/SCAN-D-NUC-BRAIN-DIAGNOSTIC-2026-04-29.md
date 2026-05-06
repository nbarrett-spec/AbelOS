# SCAN-D — NUC Brain Wiring Diagnostic

**Date:** 2026-04-29 · **HEAD:** 9004cbe · **Mode:** read-only (one report file written)
**Predecessor:** `docs/SCAN-A8-NUC-BRAIN-WIRING.md` (2026-04-27, status: red)
**Auth-fix commits already in tree:** `1f6fc64` (X-API-Key dual-send) + `fa79594` (Bearer dual-send)

## Status: amber — code is ready; one Vercel env var missing

The Aegis source code now sends every brain-aware request with **both** auth
modes (CF Access service-token *and* `X-API-Key`/`Authorization: Bearer`),
matching what the NUC's auth migration runbook says the Brain expects. The
remaining problem is that **`BRAIN_API_KEY` was never added to the Vercel
production env** (Step 4 of `NUC_CLUSTER/BRAIN_AUTH_MIGRATION.md`). Without
it the dual-send code paths attach zero `X-API-Key` / `Bearer` header, so
once CF Access is dropped from `brain.abellumber.com`, every request to the
Brain authenticates via the (now no-op) CF service token only and gets 401
back from the Brain's `AuthMiddleware`.

That matches the SCAN-A8 evidence exactly: 401 from `/brain/ingest/batch`
every hour for 1.8 days, `report.cfAuth: "ok"` (because `CF_ACCESS_*` env
vars *are* set on Vercel — see `.env.vercel-pull`), but the Brain rejecting
the call anyway because the X-API-Key channel is empty.

## 1. File-by-file inventory

All files in `abel-builder-platform/`. Unless noted, every one of these now
sends *both* `X-API-Key: <BRAIN_API_KEY>` and
`Authorization: Bearer <BRAIN_API_KEY>` (see commits 1f6fc64 + fa79594).

### Library / helpers

| File | Purpose | Endpoint | Headers sent | Env vars read |
|---|---|---|---|---|
| `src/lib/engine-auth.ts` | `verifyEngineToken` (gates `/api/v1/engine/*` routes the **NUC** calls into Aegis) + `forwardToNuc` helper | `${NUC_URL}${path}` | `Authorization: Bearer ${NUC_AGENT_TOKEN}`, `CF-Access-Client-Id/Secret` (legacy), `X-API-Key: ${BRAIN_API_KEY}` (when set) | `ENGINE_BRIDGE_TOKEN` (inbound), `NUC_URL`, `NUC_TAILSCALE_URL`, `NUC_AGENT_TOKEN`, `BRAIN_API_KEY`, `CF_ACCESS_CLIENT_ID/SECRET` |
| `src/lib/nuc-bridge.ts` | Read-only NUC FastAPI bridge (passthrough) | `${NUC_BRAIN_URL}/brain/...` (default `http://100.84.113.47:8400`) | `Authorization: Bearer ${ABEL_MCP_API_KEY}` | `ABEL_MCP_API_KEY`, `NUC_BRAIN_URL` |

### Cron routes (run on Vercel)

| File | Schedule | Endpoint | Auth headers | Env vars |
|---|---|---|---|---|
| `src/app/api/cron/aegis-brain-sync/route.ts` | hourly (vercel.json:152) | `${NUC_BRAIN_URL}/brain/ingest/batch` (via `runAegisToBrainSync`) | `CF-Access-Client-*` + `X-API-Key` + `Authorization: Bearer` | `CRON_SECRET`, `NUC_BRAIN_URL`, `CF_ACCESS_CLIENT_ID/SECRET`, **`BRAIN_API_KEY`** |
| `src/app/api/cron/brain-sync/route.ts` | (PULL, hourly) | Brain | same | same |
| `src/app/api/cron/brain-sync-staff/route.ts` | (PULL, hourly) | Brain | same | same |
| `src/app/api/cron/brain-synthesize/route.ts` | daily 06:00 (vercel.json:192) | `POST ${NUC_BRAIN_URL}/brain/trigger/{ingest,polish,narrate}` | `CF-Access-Client-*` + `X-API-Key` + `Authorization: Bearer` | same |

### v1 / staff API routes

| File | Trigger | Endpoint | Auth headers | Env vars |
|---|---|---|---|---|
| `src/app/api/v1/brain/synthesize/route.ts` | staff button | `POST ${NUC_BRAIN_URL}/brain/trigger/<stage>` | dual-send | `BRAIN_API_KEY`, `CF_ACCESS_*`, `NUC_BRAIN_URL` |
| `src/app/api/v1/brain/knowledge/route.ts` | staff query | `${NUC_BRAIN_URL}/brain/knowledge/...` | dual-send | same |
| `src/app/api/ops/brain/proxy/route.ts` | catch-all proxy from Aegis frontend | `${NUC_BRAIN_URL}/brain/<path>` (allowlisted) | dual-send + staff session check | same |
| `src/app/api/ops/brain/scores/route.ts` | dashboards | (uses bridge / proxy) | (downstream) | (downstream) |
| `src/app/api/ops/brain/webhook/route.ts` | inbound from Brain | local | (verify only) | — |
| `src/app/api/ops/brain/trigger-sync/route.ts` | staff button | local cron trigger | — | — |

### Scripts

| File | Purpose | Endpoint | Auth | Notes |
|---|---|---|---|---|
| `scripts/aegis-to-brain-sync.ts` | Imported by hourly cron *and* runnable as one-shot | `${NUC_BRAIN_URL}/brain/ingest/batch` | dual-send (lines 78–95) | Refuses to POST if `cfAuth==='missing'` (line 414) — `cfAuth` only checks CF Access vars, *not* `BRAIN_API_KEY`, so this gate is **misleading**. |
| `scripts/brain-connectivity-test.ts` | Read-only round-trip test | Jarvis proxy + direct Brain | dual-send | Writes report to `C:\Users\natha\OneDrive\Abel Lumber\AEGIS-BRAIN-CONNECTIVITY.md` and 1 InboxItem. |
| `scripts/workspace-to-brain-ingest.ts` | One-shot workspace → Brain | `${NUC_BRAIN_URL}/brain/ingest/...` | dual-send (prefers BRAIN_API_KEY) | No CronRun history. Manual invocation only. |
| `scripts/brain-growth-monitor.ts` | Snapshots Brain stats hourly | Jarvis proxy | (no auth — public proxy) | Append-only growth log. |
| `scripts/etl-brain-gaps-to-inbox.ts` | Pulls Brain `gaps` → InboxItems | Brain | (read via proxy) | One-shot ETL. |
| `scripts/run-all-brain.sh` | Orchestrator for manual full sync | — | — | Shell wrapper. |
| `scripts/_brain-helpers.mjs`, `_brain-xlsx.mjs`, `ingest-brain-extract.mjs` | Helpers / data prep | local-only | — | No network. |

### Recent commit history (brain wiring)

```
fa79594  fix(brain-auth): also send Authorization Bearer (CF strips X-API-Key)   2026-04-25
1f6fc64  feat(brain-auth): dual-send X-API-Key alongside CF Access               2026-04-24
57f192f  fix(brain): point synthesize/knowledge routes at real Brain endpoints   2026-04-23
78ad142  feat(brain): Vercel-side knowledge synthesis trigger + knowledge proxy  2026-04-23
77a2002  feat: Aegis → Brain ingest sync (push direction)                        2026-04-22
77716a7  Engine bridge: support NUC_URL + Cloudflare Access service-token        2026-04-21
6b92e9a  Add NUC engine control plane: /api/v1/engine/* relay + data bridge     2026-04-19
```

## 2. Auth flow diagram (what Aegis sends → what Brain expects)

```
┌──────────────────────────────────────────────────────────────────┐
│ Aegis (Vercel) — every brain-bound request                       │
├──────────────────────────────────────────────────────────────────┤
│ Headers attached (post commits 1f6fc64 + fa79594):               │
│   CF-Access-Client-Id     <- CF_ACCESS_CLIENT_ID    [SET ✓]      │
│   CF-Access-Client-Secret <- CF_ACCESS_CLIENT_SECRET [SET ✓]     │
│   X-API-Key               <- BRAIN_API_KEY          [MISSING ✗]  │
│   Authorization: Bearer   <- BRAIN_API_KEY          [MISSING ✗]  │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Cloudflare Tunnel — brain.abellumber.com                         │
├──────────────────────────────────────────────────────────────────┤
│ - CF strips `X-API-Key` (non-standard header)                    │
│ - CF passes `Authorization` through unchanged                    │
│ - CF Access edge: validates service token (`CF_ACCESS_*`)        │
│   - if Access app still in front: must pass                      │
│   - if Access removed (Step 7 of runbook): CF token = no-op      │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ NUC Brain — FastAPI + AuthMiddleware (per BRAIN_AUTH_MIGRATION)  │
├──────────────────────────────────────────────────────────────────┤
│ Accepts EITHER:                                                   │
│   1. session cookie (humans) — HMAC-signed, AUTH_COOKIE_SECRET   │
│   2. X-API-Key header == AUTH_API_KEY (machines)                 │
│   3. Authorization: Bearer <AUTH_API_KEY>  (ALSO accepted —     │
│      added in NUC patch fa79594 corresponds to)                  │
│                                                                   │
│ If none match → 401 {"error":"authentication required",          │
│                       "login_url":"/login"}                       │
└──────────────────────────────────────────────────────────────────┘
```

**Where the mismatch is:** `BRAIN_API_KEY` is not set on Vercel
(verified — absent from `.env.vercel-pull`). Both the `X-API-Key` and
`Authorization: Bearer` lines in every Aegis caller are gated on
`if (brainApiKey) { ... }`, so when the env var is empty, those headers
never get attached. The CF Access service token still rides on the
request, so before the CF Access app was removed it was authenticating
via the edge. After CF Access was removed (per `BRAIN_AUTH_MIGRATION.md`
Step 7), the request hits the Brain naked → `AuthMiddleware` returns 401
→ the SCAN-A8 401 storm.

## 3. Specific code fix(es) needed

**Code: none.** The dual-send code is already in tree and covers every
caller (verified: engine-auth.ts:92–100, aegis-to-brain-sync.ts:89–93,
brain-connectivity-test.ts:95–99, brain-synthesize/route.ts:38–42,
brain-sync/route.ts, brain-sync-staff/route.ts,
ops/brain/proxy/route.ts:99–103, v1/brain/synthesize/route.ts:49–53,
v1/brain/knowledge/route.ts, workspace-to-brain-ingest.ts:27).

**Two small follow-up code-quality fixes (non-blocking):**

1. **`scripts/aegis-to-brain-sync.ts:349,414`** — the `cfAuth: 'ok' | 'missing'`
   field reads only `CF_ACCESS_CLIENT_ID/SECRET`. After the migration the
   real auth lane is `BRAIN_API_KEY`. Rename to `auth: 'brainKey' | 'cfOnly'
   | 'missing'` and gate the "refuse to POST" check (line 414) on the
   actual auth lane that's configured. Right now if Nate sets only
   `BRAIN_API_KEY` (CF service token revoked), this script refuses to
   POST even though the request would succeed.

2. **`src/app/api/cron/aegis-brain-sync/route.ts:67`** — the `cfAuth` field
   is propagated into `NextResponse.json` and `CronRun.result`. Same
   rename for visibility in the cron dashboard.

3. **`src/lib/nuc-bridge.ts:84,100`** — `DEFAULT_BASE_URL` is the Tailscale
   IP (`http://100.84.113.47:8400`), unreachable from Vercel. SCAN-A8 P2.
   Default should be `https://brain.abellumber.com`; override to Tailscale
   only when running from the NUC itself or Nate's laptop.

None of these are required for the 401 storm to stop. Skipping them is fine
for the immediate fix.

## 4. Vercel env vars to verify / set

Run from the repo root with the Vercel CLI logged in:

```bash
# 1. Confirm the gap (should print nothing or show the var is unset)
vercel env ls production | grep -i brain_api_key

# 2. Pull the value off the NUC (.env on the coordinator). On Nate's machine:
ssh abel@abel-coordinator -- 'grep ^AUTH_API_KEY ~/nuc-cluster/.env'
# → AUTH_API_KEY=<value>

# 3. Add it to Vercel production
vercel env add BRAIN_API_KEY production
# (paste the AUTH_API_KEY value)

# 4. Redeploy so the env reaches the running functions
vercel --prod
```

**Other env vars that should already be set (verified present on 2026-04-29):**

| Var | Present in `.env.vercel-pull` | Notes |
|---|---|---|
| `CRON_SECRET` | yes | Gates the cron endpoint itself |
| `CF_ACCESS_CLIENT_ID` | yes | Legacy; safe to leave during cutover, no-op after CF Access removed |
| `CF_ACCESS_CLIENT_SECRET` | yes | same |
| `ENGINE_BRIDGE_TOKEN` | yes | Auth for the NUC → Aegis `/api/v1/engine/*` direction (works) |
| `NUC_URL` | yes (`https://nuc.abellumber.com`) | Coordinator path, currently hung |
| `NUC_TAILSCALE_URL` | yes | Fallback Tailscale URL (Vercel can't reach) |
| `NUC_AGENT_TOKEN` | yes | matches `COORDINATOR_API_KEY` on NUC |
| `ABEL_MCP_API_KEY` | **NOT in `.env.vercel-pull`** | Used by `nuc-bridge.ts`; Vercel calls via this bridge return `NUC_OFFLINE` until set |
| `BRAIN_API_KEY` | **NOT in `.env.vercel-pull`** | **THIS IS THE ROOT CAUSE** — the auth-migration runbook Step 4 was never executed |
| `NUC_BRAIN_URL` | not set (defaults to `https://brain.abellumber.com` in code) | OK |

> Two missing keys both originate on the same NUC `.env` file
> (`AUTH_API_KEY` → `BRAIN_API_KEY`; the MCP API key is also generated by
> `auth_setup.py`). One ssh + two `vercel env add` commands closes both
> gaps.

## 5. Pre-conditions before attempting fix

Before running `vercel env add BRAIN_API_KEY production`:

1. **Confirm Brain is online and accepting auth on the NUC side.**
   ```bash
   ssh abel@abel-coordinator -- 'docker compose ps brain'
   # → brain   Up X hours (healthy)
   ssh abel@abel-coordinator -- 'docker compose logs brain --tail=30 | grep -i auth'
   # → expect: "brain.auth: middleware active (email=n.barrett@abellumber.com)"
   ```
2. **Confirm `AUTH_API_KEY` is set on the NUC.**
   ```bash
   ssh abel@abel-coordinator -- 'test -n "$(grep ^AUTH_API_KEY ~/nuc-cluster/.env)" && echo set || echo MISSING'
   ```
   If MISSING, run Step 1 of `NUC_CLUSTER/BRAIN_AUTH_MIGRATION.md`
   (`python scripts/auth_setup.py`) before pushing to Vercel — there's
   nothing to push otherwise.
3. **No Aegis schema changes required.** The `InboxItem.brainAcknowledgedAt`
   column the cron stamps already exists (used by current passing
   `brainAcknowledgedAt: null` query in `aegis-to-brain-sync.ts:377`).
4. **No data quality blockers.** Connectivity test on 2026-04-23 showed
   1,115 events would build cleanly from the last 24h window
   (`order_placed:500, po_created:69, inbox_item_surfaced:500,
   collection_action_created:46`). Volume since then has only grown.
5. **Cutover state of CF Access is irrelevant.** With or without the CF
   Access app in front of `brain.abellumber.com`, the dual-send code now
   passes both lanes. Setting `BRAIN_API_KEY` is sufficient.
6. **Confirm `BRAIN_API_KEY === AUTH_API_KEY`.** They must match
   byte-for-byte. If you regenerate one, you have to update the other and
   redeploy/restart in this order: Vercel first (`vercel --prod`), then
   `docker restart brain` on the NUC.

## 6. Test plan — verifying the fix is live

After `vercel --prod` redeploy completes (~2 min), run these in order. Stop
on the first failure and diagnose.

### T1 — direct curl from Nate's laptop

```bash
# Should be 200 with X-API-Key (the Vercel value), regardless of CF Access state
curl -i -H "X-API-Key: $(ssh abel@abel-coordinator -- 'grep ^AUTH_API_KEY ~/nuc-cluster/.env | cut -d= -f2')" \
     https://brain.abellumber.com/brain/health
# Expect: HTTP/2 200, JSON body with total_entities/total_events fields
```

If T1 fails with 401 → AUTH_API_KEY on the NUC and the value on Vercel are
different, OR the Brain container hasn't restarted since the env was
written. Fix: `docker compose restart brain` on the NUC.

### T2 — manual cron trigger against Vercel

```bash
CRON_SECRET=$(grep ^CRON_SECRET .env.vercel-pull | cut -d'"' -f2)
curl -i -H "Authorization: Bearer $CRON_SECRET" \
     https://app.abellumber.com/api/cron/aegis-brain-sync
# Expect: HTTP/2 200 with JSON: {success: true, sent: <N>, totalEvents: <N>, errors: undefined}
```

The crucial fields:
- `success: true` and HTTP 200 (not 207).
- `sent === totalEvents`.
- `errors` should be undefined or empty.
- `cfAuth: "ok"` is fine but ignore it (misleading; see SCAN-A8 P2).

### T3 — `brain-connectivity-test.ts` (script-level read-only)

```bash
cd abel-builder-platform
# Make sure local .env has BRAIN_API_KEY for the dry run
echo "BRAIN_API_KEY=<paste AUTH_API_KEY>" >> .env
npx tsx scripts/brain-connectivity-test.ts
# Expect: 7/7 PASS (or 6 PASS + 1 SKIP if CRON_SECRET not in local env)
# Writes report to: C:\Users\natha\OneDrive\Abel Lumber\AEGIS-BRAIN-CONNECTIVITY.md
```

### T4 — confirm CronRun history flips to SUCCESS

After waiting 1 hour (next scheduled cron tick) or running T2 manually:

```sql
-- Run via Aegis ops dashboard or psql
SELECT name, status, "startedAt", "durationMs", error
FROM "CronRun"
WHERE name = 'aegis-brain-sync'
ORDER BY "startedAt" DESC LIMIT 5;
-- Expect: top row status='SUCCESS', error=NULL
```

### T5 — confirm Brain stats moving (events ingested counter)

```bash
# Via Jarvis proxy (no auth needed):
curl -s 'https://jarvis-command-center-navy.vercel.app/api/brain?endpoint=%2Fbrain%2Fhealth' \
  | jq '{events_today: .events_ingested_today, events_hour: .events_ingested_last_hour, total_events: .total_events}'
# Expect: events_ingested_last_hour > 0 within 60-90 minutes of fix
# Expect: events_ingested_today increments daily; total_events grows
```

The 2026-04-23 baseline was `total_events: 0, events_today: 84,
events_last_hour: 0`. After the fix, the next cron tick should bump
`events_last_hour` to roughly the size of the 65-min lookback window
(typically 30–80 events at current Aegis volume, sometimes 1,000+ on
big days).

### T6 — InboxItem.brainAcknowledgedAt flips for sent items

```sql
SELECT COUNT(*)
FROM "InboxItem"
WHERE "createdAt" > NOW() - INTERVAL '2 hours'
  AND "brainAcknowledgedAt" IS NOT NULL;
-- Expect: > 0 after first successful cron run
```

## 7. Rollback plan (if something goes wrong)

`BRAIN_API_KEY` is purely additive — no schema, no data migration. If the
fix causes new failures:

```bash
vercel env rm BRAIN_API_KEY production
vercel --prod
```

This returns the system to its current state (401-ing). It cannot worsen
anything. The pre-fix CF-Access path will only resume if the CF Access app
is still installed on `brain.abellumber.com`; if it's been removed,
rollback ≠ recovery — the only path forward is to fix the BRAIN_API_KEY
mismatch.

## 8. P1 follow-up wiring gaps (not blocking the fix)

These are surfaced again from SCAN-A8 — not regressions, just the same
items still open:

- **No P0 alerting on cron failure.** 44 consecutive failures over 1.8
  days produced no email/Slack/inbox item. Add: after 3 consecutive
  failures of the same cron name, write a `BRAIN_INGEST_DOWN`
  high-priority `InboxItem`.
- **No `BrainSync` model.** Add `lastSuccessfulIngestAt`, `lastError`,
  `eventsSent24h`. Surface as a "Brain freshness" tile on Executive
  dashboard.
- **`workspace-to-brain-ingest.ts` has zero CronRun history.** Either
  schedule it weekly or add a `LastRunRegistry` row so the dashboard can
  flag stale knowledge.
- **`ABEL_MCP_API_KEY` not on Vercel.** `nuc-bridge.ts` returns
  `NUC_OFFLINE` instantly; no UI is broken but every staff dashboard hit
  burns a 5s timeout. Set this env var alongside `BRAIN_API_KEY` (same
  source — `auth_setup.py` output).
- **All four worker NUCs still dark.** Pending hardware. Any feature
  keyed to worker presence renders zero. Track but not fixable from this
  diagnostic.

## 9. Readiness verdict

**Code: ready.** Every brain-aware caller dual-sends both auth lanes.
**Infra: not ready.** Vercel production env is missing `BRAIN_API_KEY`
(and `ABEL_MCP_API_KEY`). Fix is one CLI command + redeploy. ETA 5 minutes
of Nate's time, zero risk.

After fix lands, verification per Section 6 takes ~10 minutes (T1–T3
immediately, T4–T6 wait for the next hourly cron tick).
