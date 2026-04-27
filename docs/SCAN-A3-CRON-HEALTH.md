# SCAN-A3 — Cron Health Audit

HEAD `171a6b4` — generated 2026-04-27. Read-only sweep of `vercel.json`, `src/app/api/cron/**/route.ts`, `src/lib/cron.ts`, and live CronRun rows on prod Neon.

## Headline numbers

- **38 crons in vercel.json**, **40 handler routes** in code
- **5 registered crons NEVER appear in CronRun** because the handler doesn't call `startCronRun`/`withCronRun` — their history is invisible (P2 observability gap), but they do execute. Several of these have other bugs.
- **3 orphan handlers** still in code but de-registered from vercel.json (`bolt-sync`, `bpw-sync`, `cross-dock-scan`) — keep or delete.
- **8 crons with active failures in last 14d.** Two are P0 (financial-snapshot 6 days dark, brain-sync trio 100% 401 since 2026-04-25 19:00 UTC).
- **0 hung RUNNING rows >1h** at scan time — the global watchdog sweep in `startCronRun()` is doing its job.
- **REGISTERED_CRONS in `cron.ts` has drifted from vercel.json** on 6 crons (schedule mismatch, see below).

---

## P0 — Critical / dark or 100% failing

### [P0] financial-snapshot: 6 consecutive failures, JSONB cast error
**Schedule:** `0 6 * * *` (daily 6:00 UTC)
**Handler:** `src/app/api/cron/financial-snapshot/route.ts`
**Last successful run:** NEVER (zero SUCCESS rows ever)
**Recent runs (14d):** SUCCESS:0  FAILURE:6  RUNNING:0
**Issue:** The INSERT at line 122 passes `JSON.stringify(topExposures)` for the `topExposure` column, which is JSONB. Postgres now rejects:
> `ERROR: column "topExposure" is of type jsonb but expression is of type text. HINT: You will need to rewrite or cast the expression.`
Earlier history (2026-04-22) shows a prior failure mode: `relation "FinancialSnapshot" does not exist` (now fixed). Then `snapshotDate` timestamp cast error. Each fix uncovered the next bug; the JSONB cast is the current wall.
**Fix:** In the INSERT VALUES clause, change `$20` to `$20::jsonb` (parameter index for `topExposure`). One char. While there, audit other JSONB params if added later.

### [P0] brain-sync: 100% failing since 2026-04-25, all variants 401 from NUC
**Schedule:** `0 */4 * * *` (every 4h)
**Handler:** `src/app/api/cron/brain-sync/route.ts`
**Last successful run:** 2026-04-25T16:00:30 UTC
**Recent runs (14d):** SUCCESS:13  FAILURE:16  RUNNING:0
**Issue:** Brain API returns `401 authentication required` on entity fetch and scores sync. Every run since 2026-04-25 19:00 UTC has failed. Same 401 hits **brain-sync-staff** (last SUCCESS 2026-04-25T16:00, FAILURE:11), **aegis-brain-sync** (last SUCCESS 2026-04-25T19:00, then 44 consecutive FAILURE), and **brain-synthesize** (FAILURE:3, "One or more Brain trigger stages failed"). Recent commit `fa79594` ("also send Authorization Bearer (CF strips X-API-Key)") landed but evidently didn't reach the brain-sync code path — only `aegis-brain-sync` reports `cfAuth: ok` then 401 from origin, suggesting CF Access passes but the NUC `/brain/*` endpoints reject the bearer.
**Fix:** Verify `NUC_BRAIN_API_KEY` env var on Vercel matches what `100.84.113.47:8400` accepts; check the Aegis-side fetcher in `lib/integrations/brain.ts` (or wherever `brain-sync` calls) sends both `Authorization: Bearer` AND `X-API-Key` like the `aegis-brain-sync` path. Likely root cause: cred rotated on NUC ~04/25 19:00 but Vercel env not updated.

### [P0] aegis-brain-sync: 44 consecutive 401s, 0 events flowing to NUC
**Schedule:** `0 * * * *` (hourly)
**Handler:** `src/app/api/cron/aegis-brain-sync/route.ts`
**Last successful run:** 2026-04-25T19:00:08 UTC
**Recent runs (14d):** SUCCESS:54  FAILURE:44  RUNNING:0
**Issue:** Same 401 root cause as brain-sync. Every batch since 04/25 19:00 returns `Batch 1 HTTP 401: {"error":"authentication required","login_url":"/login"}`. Result payload shows `cfAuth: ok` so the CF Access challenge passes, but the origin `/brain/events` endpoint rejects the token. 30+ events queued each run, none making it through. **Two days of NUC alerts/order events are dark.**
**Fix:** Same as brain-sync above — token sync between Vercel env and NUC config.

---

## P1 — Real bugs but the cron limps along

### [P1] gmail-sync: 54% failure rate, malformed array literal in INSERT
**Schedule:** `*/15 * * * *`
**Handler:** `src/app/api/cron/gmail-sync/route.ts` → `lib/integrations/gmail.syncAllAccounts`
**Last successful run:** 2026-04-27T15:15 UTC (recent)
**Recent runs (14d):** SUCCESS:305  FAILURE:356  RUNNING:0
**Issue:** Per-message INSERT into `CommunicationLog` chokes on a Postgres TEXT[] column when the parsed Gmail "from" or "to" header contains escaped quotes around a comma-separated list. Error code `22P02 ERROR: malformed array literal: "{""mars","jazmyne.mars@hancockwhitney.com",""castaneda","carmen.castaned…`. The literal got double-quoted because the parser sliced on commas inside a quoted display name. The cron route itself is healthy — it correctly closes the CronRun row with the underlying error message — but the underlying INSERT in `lib/integrations/gmail.ts` builds the array literal by hand instead of using a parameterized `text[]` Prisma path.
**Fix:** In `lib/integrations/gmail.ts`, replace the hand-rolled `'{...}'` literal with `prisma.$executeRaw\`...$\{toArray\}::text[]\`` and pass a JS string array as a parameter. Or strip embedded quotes and commas from each address before building the literal. Will recover ~50% of message inserts.

### [P1] hyphen-sync: lying about SUCCESS — never actually syncs
**Schedule:** `15 * * * *`
**Handler:** `src/app/api/cron/hyphen-sync/route.ts`
**Last successful run:** 2026-04-27T15:15:30 UTC (every hour)
**Recent runs (14d):** SUCCESS:98  FAILURE:149  RUNNING:0
**Issue:** Every "SUCCESS" row in last 12+ hours has result `{"reason": "NO_HYPHEN_CONFIG", "skipped": true}`. The handler's intentional short-circuit at lines 41–47: if no `IntegrationConfig` row with `provider=HYPHEN AND status=CONNECTED`, it stamps `SUCCESS skipped=true` and bails. **The cron has not done a real sync in days** — Brookfield's 0/80 Hyphen-linked jobs problem (in CLAUDE.md project notes) shows up here. Auth gate is correct (`Bearer ${CRON_SECRET}`). Tracking is correct (uses `startCronRun`/`finishCronRun`). The lie is by design but it's a lie.
**Fix:** This is a config issue, not a code issue. Insert the IntegrationConfig row with provider=HYPHEN, status=CONNECTED, valid apiKey + baseUrl. Until then, the route already prints a clear "skipped" message in the result JSON — `/admin/crons` could surface skipped runs in a different color so they don't look healthy. Optional code change: emit a `WARN`-level CronRun status (currently only SUCCESS/FAILURE/RUNNING) for skipped-config runs, or include a `degraded: true` flag the dashboard can read.

### [P1] data-quality-watchdog: hits dawn.meehan inbox spam
**Schedule:** `0 12 * * *`
**Handler:** `src/app/api/cron/data-quality-watchdog/route.ts`
**Last successful run:** 2026-04-27T12:00 UTC
**Recent runs (14d):** SUCCESS:4  FAILURE:0
Healthy. Listed only because the gmail-sync `22P02` error string keeps mentioning `dawn.meehan@abellumber.com` — same root cause as gmail-sync, not a separate bug.

---

## P0/P1 — Crons NEVER tracked (no `withCronRun`), invisible to /admin/crons

These five run, but `CronRun` has zero rows for them — no proof of life, no alerting on failure, no "Run Now" history. Inferred to fire because vercel.json registers them, but if they 500'd silently nobody would notice.

### [P0] morning-briefing: NO cron tracking, no proof it's running
**Schedule:** `0 12 * * 1-5` (vercel.json) BUT `0 6 * * 1-5` (REGISTERED_CRONS) — drift
**Handler:** `src/app/api/cron/morning-briefing/route.ts`
**Last successful run:** UNKNOWN — zero CronRun rows ever
**Recent runs (14d):** N/A
**Issue:** Handler has CRON_SECRET gate but never opens a CronRun. Any failure is silently swallowed by Vercel's error log. Daily email to Nate could have been failing for days. Also schedule drift: `cron.ts` says 6:00 UTC, vercel.json says 12:00 UTC — registered_crons.ts is wrong.
**Fix:** Wrap the handler body in `withCronRun('morning-briefing', async () => { ... })`. Update `REGISTERED_CRONS.morning-briefing.schedule` to `0 12 * * 1-5`.

### [P0] weekly-report: NO cron tracking, schedule drift
**Schedule:** `0 13 * * 1` (vercel.json) BUT `0 8 * * 1` (REGISTERED_CRONS)
**Handler:** `src/app/api/cron/weekly-report/route.ts`
**Last successful run:** UNKNOWN — zero CronRun rows
**Issue:** Same as morning-briefing — no `withCronRun`. Plus 5-hour schedule drift.
**Fix:** Wrap in `withCronRun`. Sync schedule strings.

### [P1] collections-email: NO cron tracking, schedule drift, kill-switch may hide intent
**Schedule:** `0 14 * * 1-5` (vercel.json) BUT `0 10 * * 1-5` (REGISTERED_CRONS)
**Handler:** `src/app/api/cron/collections-email/route.ts`
**Last successful run:** UNKNOWN
**Issue:** No `withCronRun`. Has `COLLECTIONS_EMAILS_ENABLED !== 'true'` kill switch (line 38) — almost certainly off in prod, but even if it fired and crashed, no record. Schedule drift.
**Fix:** Wrap in `withCronRun`; have the kill-switch path still record SUCCESS skipped=true (mirror pm-daily-digest pattern at lines 162–174).

### [P1] nuc-alerts: NO cron tracking, MASSIVE schedule drift
**Schedule:** `0 */6 * * *` (vercel.json — every 6h) BUT `*/5 * * * *` (REGISTERED_CRONS — every 5 min)
**Handler:** `src/app/api/cron/nuc-alerts/route.ts`
**Last successful run:** UNKNOWN
**Issue:** No `withCronRun`. Generates InboxItem rows for credit breach / stale quote / stockout / overdue / margin erosion. Schedule drift is 72x — REGISTERED_CRONS comment says it fires every 5 min, vercel says every 6 hours. The /admin/crons page expects every-5-min cadence and will alarm "stale" on a 6h cron. Vercel.json wins (it's what actually runs), so the 6h is reality, but the comment in `cron.ts` line 283 says "Drift fix 2026-04-22: routes exist and fire" — registered the wrong cadence.
**Fix:** Pick one cadence. If Nate wants 5-min alerting, change vercel.json to `*/5 * * * *` (small Vercel cron quota impact). If 6h is fine, fix REGISTERED_CRONS to `0 */6 * * *`. Wrap handler in `withCronRun` either way.

### [P1] collections-ladder: registered + has withCronRun, but never fired
**Schedule:** `0 13 * * *`
**Handler:** `src/app/api/cron/collections-ladder/route.ts` (uses `withCronRun` line 462)
**Last successful run:** NEVER
**Recent runs (14d):** zero rows
**Issue:** Registered in BOTH vercel.json and REGISTERED_CRONS, handler has tracking, yet ZERO CronRun rows in 30 days. Either the route 500s before reaching `withCronRun` (auth gate / import error), or vercel.json deploy hasn't propagated. Worth a manual `curl -H "Authorization: Bearer $CRON_SECRET" https://app.abellumber.com/api/cron/collections-ladder` to see the real error.
**Fix:** Manual probe. If 500, fix the imports / SQL. If 200 but still no row, the auth gate is rejecting and `startCronRun` is never reached — same problem as nuc-alerts.

---

## P2 — Schedule drift (REGISTERED_CRONS vs vercel.json)

`/admin/crons` reads from REGISTERED_CRONS but Vercel runs from vercel.json. Six mismatches today:

| cron | vercel.json | REGISTERED_CRONS | impact |
|---|---|---|---|
| inflow-sync | `*/15 * * * *` | `0 * * * *` | dashboard says hourly, actually every 15m |
| morning-briefing | `0 12 * * 1-5` | `0 6 * * 1-5` | dashboard expects 6 AM UTC, fires at noon |
| weekly-report | `0 13 * * 1` | `0 8 * * 1` | 5h drift |
| pm-daily-tasks | `30 11 * * 1-5` | `0 7 * * 1-5` | 4.5h drift |
| collections-email | `0 14 * * 1-5` | `0 10 * * 1-5` | 4h drift |
| nuc-alerts | `0 */6 * * *` | `*/5 * * * *` | 72x cadence drift |

**Fix:** One PR updating REGISTERED_CRONS in `src/lib/cron.ts` lines 260–298 to mirror vercel.json. The `expectedMaxGapMinutes()` thresholds derive from the schedule string, so getting it right matters for the stale-alert detector.

---

## P2 — Orphan handlers (in code, NOT in vercel.json)

- `src/app/api/cron/bolt-sync/route.ts` — DISABLED 2026-04-23, last CronRun 04/21. File header is honest about this. Decision: delete the file or leave for re-enable. Currently leaks ~150 lines of dead code.
- `src/app/api/cron/bpw-sync/route.ts` — last CronRun 04/21 02:45, 100% FAILURE on `provider: "BPW_PULTE"` enum value. Pulte account lost 04/20. Delete.
- `src/app/api/cron/cross-dock-scan/route.ts` — last CronRun 04/24, status SUCCESS. Functional but de-registered. Decide.

---

## P2 — pm-daily-digest: confirmed gated off, gate works

**Schedule:** `0 12 * * 1-6`
**Handler:** `src/app/api/cron/pm-daily-digest/route.ts`
**Last successful run:** 2026-04-27T12:00:01 UTC
**Recent runs (14d):** SUCCESS:2  FAILURE:0
**Status:** Healthy. `FEATURE_PM_DIGEST_EMAIL` gate at line 153 returns early with `SUCCESS skipped=true` and result `{ok: true, reason: "FEATURE_OFF"}`. No emails sent, no audit log writes, no exceptions. Pattern is the right model for collections-email and nuc-alerts to copy.

---

## Auth posture summary

40 cron route files, 40 enforce `Bearer ${CRON_SECRET}`. No open-to-the-world cron handlers found. (collections-email, weekly-report, morning-briefing, nuc-alerts gate is fine; the issue is observability.)

## What to do, ranked

1. **Fix financial-snapshot JSONB cast** — one-character fix, restores daily cash/AR/DSO snapshots. (P0)
2. **Sync NUC brain auth** — restore brain-sync, brain-sync-staff, aegis-brain-sync, brain-synthesize. Probably one env var rotation on Vercel. (P0)
3. **Wrap morning-briefing, weekly-report, collections-email, nuc-alerts in withCronRun** — gives observability for ~10% of cadence. (P0/P1)
4. **Fix gmail-sync array-literal escaping** — recover 50% of CommunicationLog inserts. (P1)
5. **Investigate why collections-ladder never fires** — curl probe, then fix. (P1)
6. **Update REGISTERED_CRONS to match vercel.json** — kills 6 false-stale alerts on /admin/crons. (P2)
7. **Decide orphans:** delete bolt-sync + bpw-sync + cross-dock-scan handler files, or leave with a `// DISABLED` header. (P2)

---

*Scan ran read-only against prod Neon; no writes. Temp script `scripts/_scan_a3_cron.mjs` cleaned up.*
