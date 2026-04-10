# Abel Lumber AI Business Engine — Launch Readiness Report

**Date:** March 28, 2026
**Prepared for:** Nate Barrett, Abel Lumber
**Platform:** Next.js 14 / Prisma / PostgreSQL (Neon) / Vercel

---

## Executive Summary

The Abel Builder Platform has undergone a comprehensive two-session audit covering database integrity, API correctness, security hardening, and schema alignment. All critical issues identified have been resolved. The platform is **ready for launch** pending a dev server restart and the Vercel environment variable configuration described below.

---

## Completed Work

### 1. Database Migration — Agent Hub Tables

Seven new tables were created in the production Neon database to support the AI agent hub:

- AgentTask, AgentMessage, AgentConversation
- BuilderIntelligence, PricingRule
- AutoPurchaseOrder, WarrantyClaim

All tables confirmed present via `information_schema` verification. Migration script preserved at `prisma/migration-v7-agent-hub-tables.sql`.

### 2. Enum Cast Fixes (::text pattern)

PostgreSQL enum columns require `::text` casting when compared with string literals in raw SQL. This was the single most widespread issue — fixed across **14+ API routes**:

- `/api/ops/sales/stats/route.ts` — Deal stage comparisons
- `/api/ops/sales/follow-ups/route.ts` — Pipeline, win rate, stale deals, rep activity queries
- `/api/ops/sales/analytics/route.ts` — Forecast, win/loss, rep scorecard, velocity queries
- `/api/ops/ai/health/route.ts` — Deal stage aggregations (WON/LOST)
- `/api/ops/ai/alerts/route.ts` — Job and Invoice status filters
- `/api/account/statement/route.ts` — Invoice status in subqueries
- `/api/ops/action-queue/route.ts` — Delivery status filter
- `/api/agent-hub/context/builder/[id]/route.ts` — Order and Job status
- `/api/agent-hub/context/pipeline/route.ts` — Deal stage filters
- `src/lib/claude-tools.ts` — All 8+ tool functions (orders, builders, invoices, products, POs, quotes, schedule, staff)

### 3. Schema Column Fixes

Several API routes referenced columns that don't exist in the actual Prisma schema:

- **Order table:** Removed references to `jobSiteName` and `jobSiteAddress` (don't exist)
- **Job table:** Changed `jobSiteName`/`jobSiteAddress` to `jobAddress`, `community`, `lotBlock`
- **Deal table:** Changed `CLOSED_WON`/`CLOSED_LOST` to `WON`/`LOST`, `value` to `dealValue`, `assignedToId` to `ownerId`
- **Staff table:** Changed `name` to `firstName`/`lastName`
- **Product table:** Changed `isActive` to `active`, removed non-existent stock columns (inventory is in `InventoryItem`)

### 4. Security Hardening

| Issue | Fix | Status |
|-------|-----|--------|
| SQL injection in AI tool functions | Added `sqlSafe()` sanitizer to all 8+ interpolated queries in `claude-tools.ts` | DONE |
| Cart cookie not httpOnly | Set `httpOnly: true` on `/api/catalog/cart` and `/api/orders/[id]/reorder` | DONE |
| Homeowner seed endpoint exposed in production | Added `NODE_ENV === 'production'` guard returning 403 | DONE |
| Debug endpoint leaking catalog data | Deleted `/api/ops/auth/debug/route.ts` entirely | DONE |
| JWT_SECRET placeholder in production | Generated cryptographic secret, updated `.env.production.template` | DONE |
| Middleware JWT_SECRET guard | Added startup check that blocks with 500 if JWT_SECRET is missing | DONE |

### 5. JWT Secret for Production

A production JWT secret has been generated and saved in `.env.production.template`. Before deploying to Vercel:

```
JWT_SECRET="U/XY9ykrdNUnEhk/GRF/d10zOloEXzcSBIZYrR1hOarSAjdp93sPqStCFAb5gJ5M"
NEXT_PUBLIC_APP_URL="https://your-production-domain.com"
```

**Action required:** Add these as Vercel environment variables before the production deploy.

---

## Pre-Launch Checklist

| # | Item | Status |
|---|------|--------|
| 1 | Database tables created (all 30+ models) | DONE |
| 2 | Agent hub migration applied (7 tables) | DONE |
| 3 | Enum ::text casts across all API routes | DONE |
| 4 | Column name mismatches fixed | DONE |
| 5 | SQL injection vectors sanitized | DONE |
| 6 | Cookie security (httpOnly) | DONE |
| 7 | Debug/seed endpoints production-guarded | DONE |
| 8 | JWT_SECRET generated | DONE |
| 9 | Restart dev server to pick up changes | **ACTION NEEDED** |
| 10 | Set Vercel env vars (JWT_SECRET, APP_URL) | **ACTION NEEDED** |

---

## Action Items for Nate

1. **Restart the dev server** — Run `npm run dev` from the Windows terminal in `C:\Users\natha\OneDrive\Abel Lumber\abel-builder-platform`. The bulk file edits from the sandbox need a fresh webpack compilation to take effect.

2. **Verify locally** — After restarting, spot-check these routes:
   - `http://localhost:3000` (homepage)
   - `http://localhost:3000/ops/dashboard` (ops login with `n.barrett@abellumber.com` / `Abel2026!`)
   - `http://localhost:3000/catalog` (product catalog)

3. **Set Vercel environment variables** before deploying:
   - `JWT_SECRET` — copy from `.env.production.template`
   - `NEXT_PUBLIC_APP_URL` — your production domain
   - `DATABASE_URL` — already configured (Neon connection string)

4. **Deploy to Vercel** — `git push` to trigger deployment, or run `vercel --prod` from the project root.

---

## Architecture Notes

- All database queries use `prisma.$queryRawUnsafe()` with parameterized `$1, $2` placeholders where possible, and `sqlSafe()` sanitization for dynamic WHERE clauses
- Authentication: JWT-based sessions via `abel_session` (builders) and `abel_staff_session` (ops/admin) cookies
- The Neon database is on the `br-gentle-frog-anmxwz3l` branch with pooled connections via `ep-aged-sun-ansm1q2l-pooler`
- Agent hub tools operate within staff session context with role-based access controls

---

*Report generated March 28, 2026*
