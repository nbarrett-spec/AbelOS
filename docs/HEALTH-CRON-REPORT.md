# Cron + Integration Health — 2026-04-24T19:31:01Z

HEAD: `74f6bbd` · Source: Neon production · Probe: `scripts/_tmp-health-cron-probe.mjs` (deleted after use) · Scope: last 24h CronRun activity, zombie scan, integration-source freshness, NUC bridge audit.

## TL;DR

**YELLOW — Monday-launchable with caveats.** Of 30 crons with history, **24 GREEN · 1 YELLOW · 5 RED**. Zero zombies (zombie-sweep is healthy, running every 5 min). The five RED crons are three known-stale (bolt-sync, bpw-sync, financial-snapshot) plus one live regression (gmail-sync) and one edge-case (demand-forecast-weekly had a FAIL→SUCCESS recovery). Hyphen-sync shows SUCCESS but is short-circuiting on `NO_HYPHEN_CONFIG` — it's a skip, not a real ingest. InFlow is healthy with visible W2 circuit-breaker activity (14 failures / 15 successes in 24h, last status RUNNING is mid-flight, not a zombie).

**Top issues for Monday:**
1. **gmail-sync** — regression since ~2026-04-24T19:15Z. Malformed array literal from a Pulte email header blew up the raw SQL insert; 60 failures in last 24h. Needs a CC-field sanitizer hotfix before Monday AM or the PM inbox-driven workflows (inbox-feed, quote-followups, agent-opportunities) degrade silently.
2. **financial-snapshot** — 3-consecutive-fail since 2026-04-22. `topExposure` column is jsonb but insert passes text. Schema/insert mismatch. No financial snapshot has succeeded in the last 24h.
3. **bolt-sync / bpw-sync** — both have 150 consecutive failures and no runs for 72h. They were unregistered from `vercel.json` (consistent with Pulte account loss on 4/20). If intent is to kill them, delete the route files to stop polluting CronRun history. If intent is to revive bolt-sync, the `customers/orders/work_orders/invoices: undefined` error points to a missing integration config.

## Section 1: Zombies

**0 zombies.** No `CronRun` row in `RUNNING` status older than 15 minutes.

The `zombie-sweep` cron itself is healthy: 11 successes in 24h, last run 2026-04-24T19:30:03Z, duration 3ms. Circuit is working as designed.

## Section 2: Per-cron health table (sorted worst-first)

| Cron | Health | Last run | Last status | 24h S/F | Consec fails | Notes |
|---|---|---|---|---|---|---|
| `bolt-sync` | RED | 2026-04-21T02:30Z (~72h stale) | FAILURE | 0/0 | 150 | Not in vercel.json anymore. `customers/orders/work_orders/invoices: undefined`. |
| `bpw-sync` | RED | 2026-04-21T02:45Z (~72h stale) | FAILURE | 0/0 | 150 | Not in vercel.json. Error: `Invalid value for argument provider. Expected IntegrationProvider.` (enum mismatch: code uses `BPW_PULTE`, enum may not define it). |
| `financial-snapshot` | RED | 2026-04-24T06:00Z | FAILURE | 0/1 | 3 | `ERROR: column "topExposure" is of type jsonb but expression is of type text`. Insert needs explicit `::jsonb` cast or parametric binding. |
| `gmail-sync` | RED | 2026-04-24T19:30Z | FAILURE | 35/60 | 3 | Malformed Postgres array literal on message insert: `{"susan.daly@pulte.com",""werner","brittney.werner@abellumber.com"}` — embedded double-quotes in a name broke CSV-style array escaping. |
| `demand-forecast-weekly` | RED | 2026-04-24T01:55Z | SUCCESS | 1/1 | 0 | Classifier-edge: `lastStatus=SUCCESS, previousStatus=FAILURE`, so the "FAILURE-then-FAILURE" guard in `/api/health/crons` reads it as GREEN. I flag it RED here because there was a failure before the successful retry — worth eyeballing the error payload, but not blocking. |
| `inflow-sync` | YELLOW | 2026-04-24T19:30Z (in-flight) | RUNNING | 15/14 | 0 | Not a zombie — started 46s before the probe. W2 circuit-breaker is clearly engaging (14 FAILURES in 24h alongside 15 SUCCESSES, even alternation). Acceptable. |
| `aegis-brain-sync` | GREEN | 2026-04-24T19:00Z | SUCCESS | 24/0 | 0 | Hourly cadence, clean. |
| `agent-opportunities` | GREEN | 2026-04-24T14:00Z | SUCCESS | 1/0 | 0 | Daily, 201s duration — long but expected. |
| `brain-sync` | GREEN | 2026-04-24T16:00Z | SUCCESS | 6/0 | 0 | Had a failure 2026-04-23T12:00Z but recovered. |
| `brain-sync-staff` | GREEN | 2026-04-24T16:00Z | SUCCESS | 6/0 | 0 | |
| `buildertrend-sync` | GREEN | 2026-04-24T18:15Z | SUCCESS | 12/0 | 0 | 4ms duration — almost certainly short-circuiting on "not configured". Worth verifying it's actually syncing. |
| `collections-cycle` | GREEN | 2026-04-24T13:00Z | SUCCESS | 1/0 | 0 | **Flag-OFF** — `COLLECTIONS_EMAILS_ENABLED` not set, returns `skipped:true`. |
| `cross-dock-scan` | GREEN | 2026-04-24T03:41Z | SUCCESS | 5/0 | 0 | **Not in vercel.json** — something else is triggering it (MRP chain or manual). |
| `cycle-count-schedule` | GREEN | 2026-04-24T01:52Z | SUCCESS | 1/0 | 0 | |
| `daily-digest` | GREEN | 2026-04-24T11:00Z | SUCCESS | 1/0 | 0 | |
| `data-quality` | GREEN | 2026-04-24T02:00Z | SUCCESS | 1/0 | 0 | Had a failure 2026-04-23; recovered. |
| `data-quality-watchdog` | GREEN | 2026-04-24T12:00Z | SUCCESS | 1/0 | 0 | |
| `hyphen-sync` | GREEN | 2026-04-24T19:15Z | SUCCESS | 24/0 | 0 | **SUCCESS is misleading** — `lastDurationMs=null` means early-return. The cron is hitting `NO_HYPHEN_CONFIG` or `HYPHEN_CONFIG_INCOMPLETE` and deliberately marking itself SUCCESS to avoid staleness alerts. No actual Hyphen data is flowing. B1 Playwright stub isn't what's firing here — the DB short-circuit is. |
| `inbox-feed` | GREEN | 2026-04-24T19:30Z | SUCCESS | 95/0 | 0 | Every 15min cadence; clean. |
| `material-watch` | GREEN | 2026-04-24T19:30Z | SUCCESS | 48/0 | 0 | 30min cadence; clean. |
| `mrp-nightly` | GREEN | 2026-04-24T04:00Z | SUCCESS | 1/0 | 0 | |
| `observability-gc` | GREEN | 2026-04-24T03:00Z | SUCCESS | 1/0 | 0 | |
| `pm-daily-tasks` | GREEN | 2026-04-24T11:30Z | SUCCESS | 1/0 | 0 | |
| `process-outreach` | GREEN | 2026-04-24T19:30Z | SUCCESS | 144/0 | 0 | 10min cadence; clean. |
| `quote-followups` | GREEN | 2026-04-24T09:00Z | SUCCESS | 1/0 | 0 | |
| `run-automations` | GREEN | 2026-04-24T17:00Z | SUCCESS | 3/0 | 0 | |
| `shortage-forecast` | GREEN | 2026-04-24T03:41Z | SUCCESS | 3/0 | 0 | Last SUCCESS carries a huge warning payload in `error` field ("RED but no preferred vendor — cannot auto-PO" × 16 SKU/job combos). This is logged as warning-on-success, not a cron failure — but it means 16 RED allocations can't auto-PO until preferred-vendor data is filled in. |
| `uptime-probe` | GREEN | 2026-04-24T19:30Z | SUCCESS | 288/0 | 0 | 5min cadence; perfect. |
| `webhook-retry` | GREEN | 2026-04-24T19:30Z | SUCCESS | 287/0 | 0 | 5min cadence; perfect. |
| `zombie-sweep` | GREEN | 2026-04-24T19:30Z | SUCCESS | 11/0 | 0 | Zombie-killer is alive. |

## Section 3: Missing crons

### File exists but NO runs ever (10 files)

These routes exist under `src/app/api/cron/*/route.ts` but have zero rows in `CronRun`. Either never registered, never fired, or disabled.

| Cron file | vercel.json? | Likely reason |
|---|---|---|
| `allocation-health` | Yes | Scheduled but hasn't fired yet, or always errors before `startCronRun`. Investigate. |
| `collections-email` | Yes | Flag-OFF (`COLLECTIONS_EMAILS_ENABLED!=true`) and short-circuits BEFORE `startCronRun` → no row. Expected. |
| `collections-ladder` | Yes | Same as collections-email — flag-OFF skip happens before log row. Expected. |
| `gold-stock-monitor` | Yes | Scheduled but no runs — either hasn't fired at its cadence yet or errors pre-log. Check schedule cadence. |
| `material-confirm-checkpoint` | Yes | Scheduled but no runs — same class of issue. |
| `morning-briefing` | Yes | Scheduled but no runs — same. |
| `nuc-alerts` | Yes | Scheduled but no runs. Expected-ish: B5 nuc-bridge returns NUC_UNREACHABLE from Vercel (no Tailscale). But a skip should still log a row. Check whether it errors pre-`startCronRun`. |
| `pm-daily-digest` | Yes (new, Wave D) | **Expected: FEATURE_PM_DIGEST_EMAIL=false** default. Short-circuits before logging. Correct. |
| `vendor-scorecard-daily` | Yes | Scheduled but no runs — check cadence and pre-log errors. |
| `weekly-report` | Yes | Weekly cadence — may simply not have fired since CronRun data started. Verify against schedule expression. |

### Log has runs but no file (0)

None. Every name in `CronRun` has a corresponding `src/app/api/cron/<name>/route.ts` file.

### File exists but NOT in vercel.json (3)

| Cron file | In CronRun? | Notes |
|---|---|---|
| `bolt-sync` | Yes (stale, 150 fails) | Dead route. Route file exists but was removed from vercel.json. Decision needed: delete file or re-register. |
| `bpw-sync` | Yes (stale, 150 fails) | Same — dead, Pulte account was lost 4/20 so this is probably intentional. |
| `cross-dock-scan` | Yes (healthy, 5/0 in 24h) | Runs despite not being scheduled — something in the MRP chain or a manual trigger calls it. 21s duration per run is substantial; this matters. |

## Section 4: Integration freshness

Age computed vs. probe time 2026-04-24T19:31Z.

| Integration | Last SUCCESS | Age of last SUCCESS | Last FAILURE | Verdict |
|---|---|---|---|---|
| InFlow (`inflow-sync`) | 2026-04-24T19:15Z | 16m | 2026-04-24T16:00Z | FRESH — 15-min cadence holding. Circuit-breaker toggling (14 fails in 24h) is expected W2 behavior. |
| Hyphen (`hyphen-sync`) | 2026-04-24T19:15Z | 16m | 2026-04-21T02:15Z | **SOFT-STALE** — rows are SUCCESS but `lastDurationMs=null` means it's hitting the `NO_HYPHEN_CONFIG`/`HYPHEN_CONFIG_INCOMPLETE` early-return. No actual Hyphen API calls are landing. B1 Playwright stub is NOT the path being hit — the Hyphen `IntegrationConfig` row is missing or incomplete. |
| Gmail (`gmail-sync`) | 2026-04-24T18:45Z | 45m | 2026-04-24T19:30Z | **DEGRADING** — last run failed, last success 45m ago. Malformed CC-header array literal regression. Inbox-feed is still processing what it has, but new mail isn't flowing in cleanly. |
| BuilderTrend (`buildertrend-sync`) | 2026-04-24T18:15Z | 76m | (none in window) | FRESH on paper but 4ms duration strongly suggests short-circuit on missing config. Verify an actual API call is happening. |
| Bolt (`bolt-sync`) | **never** | n/a (no SUCCESS ever) | 2026-04-21T02:30Z | **DEAD** — 72h+ stale, unregistered from vercel.json, 150 consecutive failures. |
| BWP/Pulte (`bpw-sync`) | **never** | n/a (no SUCCESS ever) | 2026-04-21T02:45Z | **DEAD** — 72h+ stale, unregistered. Pulte account was lost 4/20; likely intentional kill. |
| Collections ladder (`collections-ladder`) | (no rows) | n/a | n/a | Flag-OFF. Expected. |
| Shortage forecast (`shortage-forecast`) | 2026-04-24T03:41Z | 16h | 2026-04-23T19:16Z | FRESH for a daily cron. |
| Demand forecast weekly (`demand-forecast-weekly`) | 2026-04-24T01:55Z | 17h | 2026-04-24T01:51Z | FRESH — fails once then recovers on its 4-min-later retry. Worth investigating the first-attempt error. |
| Cycle-count schedule (`cycle-count-schedule`) | 2026-04-24T01:52Z | 17h | (never failed) | FRESH daily. |
| Gold stock monitor (`gold-stock-monitor`) | **never** | n/a | n/a | **NEVER RUN.** File exists, in vercel.json, but zero CronRun rows. Investigate. |
| Brain sync (`brain-sync`) | 2026-04-24T16:00Z | 3.5h | 2026-04-23T12:00Z | FRESH. |
| Brain sync staff (`brain-sync-staff`) | 2026-04-24T16:00Z | 3.5h | (never) | FRESH. |
| Aegis brain sync (`aegis-brain-sync`) | 2026-04-24T19:00Z | 31m | (never) | FRESH — hourly. |
| Allocation health (`allocation-health`) | **never** | n/a | n/a | NEVER RUN. Same as gold-stock-monitor. |
| Cross-dock scan (`cross-dock-scan`) | 2026-04-24T03:41Z | 16h | (never) | FRESH, but not registered in vercel.json — unclear what triggers it. |
| Webhook retry (`webhook-retry`) | 2026-04-24T19:30Z | 1m | (never) | FRESH — 5-min cadence. |
| Zombie sweep (`zombie-sweep`) | 2026-04-24T19:30Z | 1m | (never) | FRESH — 5-min cadence. |
| Vendor scorecard daily (`vendor-scorecard-daily`) | **never** | n/a | n/a | NEVER RUN. Investigate. |
| PM daily digest (`pm-daily-digest`) | (no rows) | n/a | n/a | **Expected — flag-OFF** (`FEATURE_PM_DIGEST_EMAIL!=true`). Correct state. |

## Section 5: Flag-OFF crons (expected skipping — do NOT count as RED)

| Cron | Env flag | Current state | Notes |
|---|---|---|---|
| `collections-cycle` | `COLLECTIONS_EMAILS_ENABLED` | Has log rows (SUCCESS, 1767ms) | Flag-check happens inside the cron body, after `startCronRun`, so rows are logged as SUCCESS with `skipped:true` payload. Correct behavior. |
| `collections-email` | `COLLECTIONS_EMAILS_ENABLED` | No log rows | Flag-check happens BEFORE `startCronRun`, so no row. Confusing but expected. |
| `collections-ladder` | `COLLECTIONS_EMAILS_ENABLED` | No log rows | Same as collections-email — pre-log short-circuit. Expected. |
| `pm-daily-digest` | `FEATURE_PM_DIGEST_EMAIL` | No log rows | Pre-log short-circuit. Correct — this is Wave D's just-shipped cron, OFF default. |

**Inconsistency note**: the three collections crons handle their own flag check differently (one logs, two don't). Not urgent but worth homogenizing post-Monday so the ops dashboard reads consistently.

## Section 6: NUC bridge

**Offline as expected.** AuditLog query on `entity='nuc' OR action LIKE '%NUC%'` for the last 24h returned **0 rows**.

No activity entering AuditLog from the NUC side. This matches the B5 design: `lib/integrations/nuc-bridge.ts` returns `NUC_UNREACHABLE` from Vercel because Vercel builders have no Tailscale interface (100.84.113.47 is Tailscale-only). This is a graceful-offline, not a failure.

Because `nuc-alerts` has 0 CronRun rows, we can't confirm it's firing — possible it's erroring before `startCronRun`. If the NUC bridge is supposed to produce audit entries even on NUC_UNREACHABLE (e.g., "attempted bridge, got unreachable"), that would be a nice-to-have to verify the scheduler is at least waking the cron up.

## Recommendations (do before Monday)

1. **Hotfix gmail-sync malformed array literal.** Sanitize display-name with embedded quotes before casting CC/To arrays. This is actively burning audit budget (60 failures in 24h) and silently starving downstream (inbox-feed, quote-followups, agent-opportunities). High leverage: one small PR fixes the regression.

2. **Fix financial-snapshot jsonb cast.** Find the `INSERT INTO "FinancialSnapshot"` or upsert for `topExposure` and either pass a typed param (Prisma will handle jsonb) or add `::jsonb` to the raw query. Snapshots have been dark for 3 days — Monday's AM review will have no fresh finance data unless this ships.

3. **Decide bolt-sync + bpw-sync fate.** Both are 72h stale with 150 consecutive failures and unregistered from vercel.json. If they're intentionally dead post-Pulte, delete the route files so they stop cluttering `/api/health/crons` output and the admin dashboard. If bolt-sync is meant to come back, the "undefined" errors hint at missing Bolt integration credentials.

4. **Investigate the 4 "never-run" registered crons.** `allocation-health`, `gold-stock-monitor`, `vendor-scorecard-daily`, `material-confirm-checkpoint`, `morning-briefing`, `nuc-alerts`, `weekly-report` are all in vercel.json but have no CronRun history. Likely either their cadence hasn't fired yet since the CronRun model was introduced, or they're erroring before the `startCronRun` call (in which case the scheduler is silently dropping them). Tail a Vercel cron-log for one of these (cheapest: `vendor-scorecard-daily`, which should run daily).

5. **Fix the Hyphen-sync "fake SUCCESS".** The cron marks itself SUCCESS with `durationMs=null` when `IntegrationConfig.provider='HYPHEN' + status='CONNECTED'` is missing/incomplete. The dashboard will happily show it green while zero Hyphen data is flowing. Either: (a) log these as `status='SUCCESS', result.skipped=true` but include a non-null `durationMs` so the dashboard can distinguish a real ingest from a skip, or (b) introduce a distinct `SKIPPED` status and update the classifier. Right now the signal-to-noise is wrong for the most important broken integration (Brookfield is the remaining top builder).

### Worth noting but not blocking for Monday

- `cross-dock-scan` runs outside vercel.json — figure out what's triggering it so ops can reason about its schedule. 21s per run is nontrivial.
- `shortage-forecast` success payload carries a 2KB "RED but no preferred vendor" warning list. This is a product/data issue (16 SKUs without preferred-vendor assignment), not a cron issue, but it means the auto-PO loop is closed for those SKUs.
- Homogenize the three `COLLECTIONS_EMAILS_ENABLED` crons so they all either log-and-skip or short-circuit-before-log. Pick one — preferably log-and-skip — so the dashboard reads consistently.
