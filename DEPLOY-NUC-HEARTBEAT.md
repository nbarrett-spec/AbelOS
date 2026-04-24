# NUC Heartbeat System — Deploy Brief

**Date:** 2026-04-24
**Author:** Cowork session (Nate Barrett)
**Status:** Code complete, ready for review + deploy

---

## Problem

The executive dashboard's NUC status card shows "Offline" because Vercel can't reach the NUC's Tailscale IP (`100.84.113.47:8400`). The old approach was **pull-based** — Aegis tried to call the NUC directly, which only works from Nate's local machine (which has Tailscale).

## Solution

**Push-based heartbeat.** The NUC pushes health data to Aegis every 60s over the public internet. The dashboard reads from the database instead of trying to reach the NUC directly.

```
NUC coordinator (Tailscale network)
  │
  │  POST /api/v1/engine/heartbeat (every 60s)
  │  Auth: Bearer ENGINE_BRIDGE_TOKEN
  │  Body: { nodeId, status, moduleStatus, engineVersion, ... }
  ▼
Aegis (app.abellumber.com / Vercel)
  │
  │  Upserts into NucHeartbeat table (Neon Postgres)
  │
  ▼
Executive Dashboard
  │  GET /api/ops/nuc/status (polls every 60s)
  │  Auth: staff session cookie
  │  Reads latest heartbeat from DB
  ▼
NucStatusCard renders: online / degraded / offline
  - "stale" after 180s (3 missed heartbeats)
```

---

## Changed Files

### New files

| File | Purpose |
|------|---------|
| `src/app/api/v1/engine/heartbeat/route.ts` | POST endpoint — NUC pushes health here. Uses `verifyEngineToken()` from `engine-auth.ts`. Upserts one row per `nodeId` via raw SQL. |
| `src/app/api/ops/nuc/status/route.ts` | GET endpoint — dashboard reads latest heartbeat(s). Uses `checkStaffAuth()`. Returns `{ ok, nodes[], coordinator, checkedAt }`. Marks heartbeats stale after 180s. |
| `prisma/migrations/create_nuc_heartbeat.sql` | Creates `NucHeartbeat` table with unique index on `nodeId` and descending index on `receivedAt`. |
| `scripts/nuc-heartbeat.sh` | Bash script for the NUC cron. Queries local `/brain/health`, constructs JSON payload, POSTs to Aegis. |

### Modified files

| File | Change |
|------|--------|
| `src/app/ops/executive/NucStatusCard.tsx` | Rewired to poll `/api/ops/nuc/status` (DB-backed) instead of `/api/integrations/nuc/health` (Tailscale-routed). Added uptime display, staleness detection, multi-node support. |
| `src/middleware.ts` | Added `/api/v1/engine` with Bearer auth to CSRF skip list (line ~261). Server-to-server calls have no Origin header. |
| `prisma/schema.prisma` | Added `NucHeartbeat` model (between `UptimeProbe` and `VendorPerformance`). |

### Restored files (38 truncated files from prior sessions)

These files were corrupted (truncated mid-content) in the workspace but intact in git HEAD. All restored via `git checkout HEAD --`. Critical ones include:

- `src/app/api/ops/auth/forgot-password/route.ts` — **This was truncated at line 125 (mid-HTML email template), causing the reset password email to 500 on Vercel. This is likely why the reset email link was "broken."**
- `src/app/api/ops/staff/route.ts` — staff creation + invite email
- `src/app/api/auth/login/route.ts`, `signup/route.ts`, `reset-password/route.ts`
- `src/app/ops/executive/page.tsx`, `layout.tsx`, `finance/page.tsx`
- `src/lib/integrations/inflow.ts`, `gmail.ts`
- `src/lib/allocation/allocate.ts`, `src/lib/cron.ts`
- Full list: run `git diff --stat HEAD` to see all

---

## Database Migration

Run this SQL on Neon **before deploying**:

```bash
psql $DATABASE_URL -f prisma/migrations/create_nuc_heartbeat.sql
```

Creates:
- `NucHeartbeat` table (id, nodeId, nodeRole, engineVersion, status, moduleStatus, latencyMs, uptimeSeconds, errorCount, lastScanAt, meta, receivedAt, createdAt)
- Unique index on `nodeId` (one row per NUC node, upserted each tick)
- Descending index on `receivedAt`

After migration, regenerate Prisma client:
```bash
npx prisma generate
```

---

## Environment Variables

### Required on Vercel (check these exist)

| Variable | Value | Notes |
|----------|-------|-------|
| `ENGINE_BRIDGE_TOKEN` | *(shared secret)* | Must match what the NUC sends. Check if already set — it's used by existing `/api/v1/engine/*` routes. |
| `NEXT_PUBLIC_APP_URL` | `https://app.abellumber.com` | **Currently NOT set.** Fixes email URL fallback warnings. Not strictly required (fallback works) but should be set. |

### Required on the NUC coordinator

| Variable | Value |
|----------|-------|
| `AEGIS_URL` | `https://app.abellumber.com` |
| `ENGINE_BRIDGE_TOKEN` | *(same shared secret as Vercel)* |
| `NUC_NODE_ID` | `coordinator` (default) |
| `NUC_BRAIN_PORT` | `8400` (default) |

---

## NUC Cron Setup

After Vercel deploy succeeds, install the heartbeat cron on the NUC coordinator:

```bash
# Copy script
scp scripts/nuc-heartbeat.sh nuc-coordinator:/opt/abel/

# On the NUC:
chmod +x /opt/abel/nuc-heartbeat.sh

# Add to crontab (every minute)
(crontab -l 2>/dev/null; echo '* * * * * AEGIS_URL=https://app.abellumber.com ENGINE_BRIDGE_TOKEN=<token> /opt/abel/nuc-heartbeat.sh >> /var/log/nuc-heartbeat.log 2>&1') | crontab -

# Test manually first
AEGIS_URL=https://app.abellumber.com ENGINE_BRIDGE_TOKEN=<token> /opt/abel/nuc-heartbeat.sh
```

Expected output on success: `[2026-04-24T...] heartbeat OK (status=online, latency=12ms)`

---

## Verification Checklist

### Pre-deploy

- [ ] `prisma/migrations/create_nuc_heartbeat.sql` — run on Neon
- [ ] `npx prisma generate` — regenerate client with NucHeartbeat model
- [ ] `npx tsc --noEmit` — 0 errors in source files (Prisma types error is expected until `prisma generate`)
- [ ] `ENGINE_BRIDGE_TOKEN` env var exists on Vercel
- [ ] Optionally add `NEXT_PUBLIC_APP_URL=https://app.abellumber.com` to Vercel

### Post-deploy

- [ ] `GET /api/ops/nuc/status` returns `{ ok: false, nodes: [], coordinator: null }` (no heartbeat yet — table is empty)
- [ ] NucStatusCard on executive dashboard shows "Offline — no heartbeat received" (not "Health check failed")
- [ ] Run `nuc-heartbeat.sh` on the NUC coordinator → should return 200
- [ ] `GET /api/ops/nuc/status` now returns `{ ok: true, coordinator: { nodeId: "coordinator", status: "online", ... } }`
- [ ] NucStatusCard shows green "Engine online" with module status and uptime
- [ ] Wait 60s, refresh dashboard — "Checked just now" updates
- [ ] Trigger forgot-password email — link should work now (truncated route file was restored)

### Rollback

If the heartbeat endpoint causes issues:
1. The old `/api/integrations/nuc/health` route still exists (unchanged)
2. Revert `NucStatusCard.tsx` to poll `/api/integrations/nuc/health` instead of `/api/ops/nuc/status`
3. The `NucHeartbeat` table can be dropped: `DROP TABLE IF EXISTS "NucHeartbeat"`

---

## Architecture Notes

**Auth flow:** The heartbeat POST uses `verifyEngineToken()` from `src/lib/engine-auth.ts` — same auth as all other `/api/v1/engine/*` routes. Timing-safe comparison of `ENGINE_BRIDGE_TOKEN`. The NUC sends `Authorization: Bearer <token>` + `X-Workspace-Id: abel-lumber`.

**CSRF:** The middleware now skips CSRF for `/api/v1/engine/*` with Bearer auth (line ~261 in middleware.ts). This is correct because the NUC sends server-to-server requests with no browser origin.

**Staleness:** A heartbeat is "stale" after 180s (3 missed 60s ticks). The status endpoint reports `isStale: true` and the card shows "Offline — last heartbeat Xm ago".

**Multi-node ready:** The table is keyed on `nodeId`. When worker NUCs come online, each pushes its own heartbeat row. The status endpoint returns all nodes, and the card shows a node count when >1.

**Graceful degradation:** If the `NucHeartbeat` table doesn't exist yet (migration not run), the GET endpoint catches the query error and returns `{ ok: false, error: "NucHeartbeat table not found..." }`. The card renders "Offline" cleanly.
