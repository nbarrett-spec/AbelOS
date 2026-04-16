# Deploy Checklist: Observability Stack Changes

**Date:** 2026-04-16 | **Platform:** Vercel (auto-deploy from GitHub main)

Use this checklist before pushing any changes to the observability, auth, cron, or alerting systems.

---

## Pre-Deploy

- [ ] All changes committed locally with descriptive commit messages
- [ ] No `.env` files, secrets, or API keys in the commit
- [ ] `npx prisma validate` passes (if schema changed)
- [ ] `npx tsc --noEmit` passes (TypeScript compile check)
- [ ] New cron jobs added to BOTH `vercel.json` AND `REGISTERED_CRONS` in `src/lib/cron.ts`
- [ ] New cron handlers use `startCronRun`/`finishCronRun` for tracking
- [ ] New admin endpoints import `checkStaffAuthWithFallback` (not `checkStaffAuth`)
- [ ] New ops endpoints import `checkStaffAuth`
- [ ] If JWT payload changed: existing sessions will break — plan for staff re-login
- [ ] If `JWT_SECRET` rotated: ALL sessions invalidated — notify team first
- [ ] Rollback plan documented (see below)

## Database Changes

- [ ] If adding tables: include auto-create/ensure pattern (see `ensureTable()` in `cron.ts`)
- [ ] If adding indexes: verify they won't lock large tables for extended periods
- [ ] If changing retention: update `observability-gc` handler AND the runbook retention table
- [ ] If Prisma migration needed: run `npx prisma migrate deploy` after Vercel deploy

## Deploy

- [ ] Push to GitHub main: `git push origin main`
- [ ] Watch Vercel deployment in dashboard (should auto-trigger within 30 seconds)
- [ ] Wait for build to complete (typical: 60-90 seconds)
- [ ] Verify deployment URL is accessible: `curl -s https://<domain>/api/health/ready`

## Post-Deploy Smoke Tests

Run these in order. All require an active staff session.

```bash
# 1. Health check (no auth needed)
curl -s https://<domain>/api/health/ready | jq .status
# Expected: "ok"

# 2. Admin auth working
curl -s https://<domain>/api/admin/alert-mute \
  -H "Cookie: abel_staff_session=<token>" | jq .total
# Expected: a number (0 or more)

# 3. SLO dashboard data flowing
curl -s https://<domain>/api/admin/slo \
  -H "Cookie: abel_staff_session=<token>" | jq '.slos | length'
# Expected: 3

# 4. Cron tracking working
curl -s https://<domain>/api/admin/crons \
  -H "Cookie: abel_staff_session=<token>" | jq '.crons | length'
# Expected: 12

# 5. Security events endpoint
curl -s https://<domain>/api/admin/security-events \
  -H "Cookie: abel_staff_session=<token>" | jq .total
# Expected: a number

# 6. Alert notification pipeline (dry run only)
curl -s https://<domain>/api/admin/test-alert-notify \
  -H "Cookie: abel_staff_session=<token>" | jq .recipients
# Expected: array of email addresses (or note about ALERT_NOTIFY_EMAILS)
```

## Monitor (15 minutes post-deploy)

- [ ] Check `/admin` dashboard — no new CRITICAL incidents
- [ ] Check `/admin/slo` — no SLO regressions
- [ ] Check `/admin/crons` — no new drift (orphaned/stale/never-run)
- [ ] Check Vercel Functions tab — no elevated error rate
- [ ] If cron changes: wait for next scheduled run and verify in `/admin/crons`

## Rollback Triggers

Roll back immediately (revert commit + force push, or redeploy previous commit from Vercel dashboard) if:

- `/api/health/ready` returns non-200 for > 2 minutes
- Availability SLO drops below 99.5% (burn rate spike)
- Error rate exceeds 100 errors in 15 minutes
- All admin endpoints return 401 (auth regression)
- Any cron that was previously healthy starts failing

## Rollback Procedure

1. Go to Vercel Dashboard > Deployments
2. Find the last known-good deployment
3. Click the three-dot menu > "Promote to Production"
4. Verify health check passes on the rolled-back version
5. Investigate the failed deploy locally before re-attempting

## Environment Variables to Verify

If the deploy involves new env vars, confirm they're set in Vercel:

| Variable | Used By | Required |
|----------|---------|----------|
| `JWT_SECRET` | All staff auth | Yes (app crashes without it in production) |
| `CRON_SECRET` | All cron handlers | Yes (crons return 401 without it) |
| `ALERT_NOTIFY_EMAILS` | Alert notification pipeline | No (graceful degradation — returns 503) |
| `RESEND_API_KEY` | Email sending (alerts + outreach) | Yes for email features |
| `INTERNAL_LOG_SECRET` | Edge-to-DB security event bridge | Yes for security logging from middleware |
