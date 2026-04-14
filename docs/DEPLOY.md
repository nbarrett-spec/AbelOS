# Abel OS — Deployment Guide

**Target:** Vercel (Edge Network)  
**Domain:** app.abellumber.com  
**Effective:** April 13, 2026 (Go-Live)

---

## Quick Deploy

```bash
# For developers: Just push to main branch
git commit -am "feat: add new endpoint"
git push origin main

# Vercel auto-deploys within 2 minutes
# Monitor: https://vercel.com/teams/abel-lumber/abel-builder-platform/deployments

# Promote preview to production (if needed)
vercel promote <preview-url>
```

---

## Pre-Deploy Checklist

Before merging to `main`:

- [ ] **Typecheck passes:** `npx tsc --noEmit` (exit 0)
- [ ] **Build succeeds:** `npm run build` (no errors)
- [ ] **DB migrations reviewed:** Any schema changes? Run locally first.
- [ ] **Env vars confirmed:** All required vars set in Vercel dashboard (see `.env.example`)
- [ ] **Code review approved:** At least one other engineer
- [ ] **Integrity checks pass (staging):** `npx tsx prisma/integrity-checks.ts`
- [ ] **Manual smoke test:** Login, view orders, create quote (on staging if available)

---

## Environment Variables

### Required (Production)

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Neon connection string | Pooled connection endpoint (ending in `-pooler`) |
| `JWT_SECRET` | 64+ random chars | `openssl rand -base64 48` — NEVER use same as dev |
| `NODE_ENV` | `production` | Critical for security headers & cookie settings |
| `NEXT_PUBLIC_APP_URL` | `https://app.abellumber.com` | Canonical domain for redirects, CORS |
| `CRON_SECRET` | 64 hex chars | `openssl rand -hex 32` for Vercel cron auth |

### Recommended (Production)

| Variable | Service | Where to Get |
|----------|---------|--------------|
| `RESEND_API_KEY` | Email | https://resend.com/api-keys |
| `STRIPE_SECRET_KEY` | Payments | https://dashboard.stripe.com/apikeys (live key) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | https://dashboard.stripe.com/webhooks → copy signing secret |
| `ANTHROPIC_API_KEY` | Claude AI | https://console.anthropic.com/account/keys |
| `SENTRY_DSN` | Error tracking | https://sentry.io/settings/abel-lumber/projects/abel-builder-platform/keys/dsn/ |
| `SENTRY_AUTH_TOKEN` | Sentry (sourcemap upload) | https://sentry.io/settings/account/api/auth-tokens/ |
| `UPSTASH_REDIS_REST_URL` | Rate limiter | https://console.upstash.com (Redis database) |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiter | Same console as above |

### How to Set in Vercel Dashboard

1. Go to https://vercel.com/teams/abel-lumber/abel-builder-platform
2. Settings → Environment Variables
3. Add/update each variable
4. Redeploy after changing (or wait for next git push)

### Validate Env Vars on Deploy

The app validates required vars at startup (see `src/lib/env.ts`). If any critical var is missing, deployment will fail with a clear error message.

---

## Database Migrations

### Migration Policy

1. **Create migration locally** (dev environment):
   ```bash
   npm run db:migrate
   # This creates a timestamped migration file in prisma/migrations/
   ```

2. **Test migration locally**:
   ```bash
   # Drop & recreate DB
   npm run db:migrate
   npm run db:seed
   npm run build
   ```

3. **Commit migration to git**:
   ```bash
   git add prisma/migrations/
   git commit -m "feat: add order_notes column to Order"
   git push
   ```

4. **Deploy**:
   - Merge to `main`
   - Vercel deploys (but DB migration runs DURING deployment via `prisma migrate deploy` in build hook)
   - If migration fails, Vercel rollback is automatic

5. **Verify migration applied**:
   ```bash
   # Check Neon dashboard: Insights → Migrations (or run SQL check)
   SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 1;
   ```

### Rollback a Migration

**If migration is applied and needs reversal:**

1. Create a new migration to undo changes:
   ```bash
   npm run db:migrate
   # Manually write DOWN steps in new migration file
   ```

2. Or restore from Neon snapshot (pre-migration):
   - Neon console → main branch → Snapshots
   - Restore from timestamp before migration
   - This resets DB to that point; data after snapshot is lost

---

## Build Configuration

### Build Command
```bash
npm run build
```

Runs:
1. Prisma code generation (`prisma generate`)
2. TypeScript build
3. Next.js build (minify, code split, generate static pages)
4. Sentry sourcemap upload (if `SENTRY_AUTH_TOKEN` set)

**Expected output:**
- Build completes in <3 min (depending on deps)
- No TypeScript errors
- Vercel displays "Production deployment" link

### Output Directory
- Vercel auto-detects `.next/` (Next.js default)
- Do NOT change

---

## Post-Deploy Verification

### Immediate (Within 5 minutes)

1. **Check deployment status:**
   ```bash
   # Via CLI
   vercel status
   
   # Or web: https://vercel.com/teams/abel-lumber/abel-builder-platform/deployments
   # Should show latest deploy with status "READY" (green checkmark)
   ```

2. **Test health endpoint:**
   ```bash
   curl -s https://app.abellumber.com/api/health | jq .
   # Should return: { "status": "ok", "db": true, "sentry": true, "upstash": true }
   ```

3. **Smoke test (manual):**
   - Visit https://app.abellumber.com (should load homepage)
   - Login with test builder account
   - View orders list
   - Create a test quote

4. **Check Sentry for errors:**
   - https://sentry.io/organizations/abel-lumber
   - Filter: `environment:"production"`
   - Should NOT see new errors from this deploy

### Ongoing (First 24 hours)

1. **Monitor error rate** (every hour):
   - Sentry dashboard: Should stay <1 error/minute
   - Alert if >5 errors/min sustained

2. **Watch Vercel logs:**
   ```bash
   vercel logs --prod --follow
   # Look for 500s, timeouts, or high latency endpoints
   ```

3. **Check database metrics** (Neon console):
   - Active connections: Should stay <50
   - Query latency: p99 <500ms (normal)
   - Storage: Verify no unexpected growth

4. **Monitor Stripe webhooks:**
   - https://dashboard.stripe.com/webhooks
   - Any failed deliveries indicate issue

---

## Rollback Procedures

### Quick Rollback (< 2 minutes)

If latest deploy is broken, revert via Vercel dashboard:

1. Go to https://vercel.com/teams/abel-lumber/abel-builder-platform/deployments
2. Find the last **successful** (green checkmark) deployment
3. Click "..." menu → **Promote to Production**
4. Confirm

This instantly reverts to that version without a new git push.

### Git-Based Rollback

If you need to revert code:

```bash
git log --oneline
git revert HEAD~1  # Revert last commit
git push
# Vercel auto-deploys the revert
```

Use `git revert` (safer) instead of `git reset --hard` (rewrites history).

### Database Rollback (Nuclear Option)

If migrations corrupted data:

1. **Neon console** → main branch → Snapshots
2. **Restore** from pre-incident snapshot
3. **Downgrade code** via git rollback (above)
4. This resets DB + app to a known-good state

**Cost:** Data between snapshot and now is lost. Use only for critical corruption.

---

## DNS & Domain Setup

### Current Configuration
- **Domain:** app.abellumber.com
- **DNS Provider:** [Check Vercel dashboard or ask Nate]
- **SSL Certificate:** Auto-issued by Vercel (free)

### DNS Check

```bash
# Verify domain points to Vercel
nslookup app.abellumber.com

# Expected: Should resolve to Vercel's IP range
# Vercel edge network routes the request globally
```

### If Domain Isn't Resolving

1. **Check Vercel dashboard:**
   - Settings → Domains
   - Status should show "Valid" with green checkmark

2. **Check DNS provider:**
   - Login to DNS provider (Cloudflare, Route53, etc.)
   - Look for CNAME or A record pointing to Vercel
   - Propagation can take 10-60 min for DNS changes

3. **Force DNS refresh:**
   ```bash
   # macOS/Linux
   sudo dscacheutil -flushcache
   
   # Windows
   ipconfig /flushdns
   
   # Or wait and retry (DNS caches refresh periodically)
   ```

---

## Feature Deployments

### Preview Deployments
Vercel auto-creates a preview URL for every branch push:
```
https://abel-builder-platform-{branch-name}.vercel.app
```

Use for testing before merge to main.

### Staged Deployments (A/B Testing)
Not currently configured. For Phase 2.

### Canary Deployments (Gradual Rollout)
Not currently configured. For Phase 2.

---

## Troubleshooting Deployments

### Build Fails: "TypeScript errors"
```bash
# Locally, run:
npx tsc --noEmit
# Fix errors, then re-push
```

### Build Fails: "Missing environment variable"
1. Check Vercel dashboard: Settings → Environment Variables
2. Verify all vars from `.env.example` are present
3. Redeploy after adding missing vars (or wait for next git push)

### Deployment is Slow (> 5 minutes)
- Vercel caches dependencies; first deploy is slower
- Subsequent deploys typically <2 min
- If consistently slow, contact Vercel support

### Deployment Succeeds but App Returns 500s
1. Check Vercel logs: `vercel logs --prod`
2. Check Sentry: https://sentry.io/organizations/abel-lumber
3. Likely cause: Environment variable issue or database unreachable
4. Verify DATABASE_URL is set and Neon is reachable

### Database Connection Fails on Deploy
1. Check Neon console: Is the database online?
2. Check CONNECTION_URL format: Should end in `-pooler` for serverless
3. Check IP allowlist: Vercel IPs may need whitelisting (Neon doesn't use this, but check if using external DB)

---

## Edge Functions & Middleware

Abel OS uses Edge Middleware (not Edge Functions) for authentication:
- File: `src/middleware.ts`
- Runs at Vercel Edge Network (before reaching serverless functions)
- Validates JWT and checks user roles
- No cold starts; sub-10ms latency

No additional config needed for deployment.

---

## Performance Considerations

### Build Time
- Current: ~2 minutes
- To optimize: Remove unused dependencies, audit bundle size

### Runtime Performance
- Prisma queries: Pooled connection (via Neon `-pooler` endpoint)
- Rate limiting: Upstash Redis (globally distributed)
- Images: Next.js auto-optimizes to AVIF/WebP

### Monitoring
- Vercel Analytics: https://vercel.com/teams/abel-lumber/abel-builder-platform/analytics
- Sentry Performance: https://sentry.io/organizations/abel-lumber/performance/

---

## Deployment Checklist (Final)

Before clicking "Deploy" or pushing to main:

```
Pre-Deploy:
  [ ] npm run build — Passes locally
  [ ] npx tsc --noEmit — No TS errors
  [ ] Migrations tested locally
  [ ] All env vars set in Vercel dashboard
  [ ] Code reviewed & approved
  [ ] No console.warn or console.error in logs

During Deploy:
  [ ] Monitor Vercel build log in real-time
  [ ] Watch for TypeScript or build errors
  [ ] Note deployment timestamp

Post-Deploy (within 5 min):
  [ ] curl /api/health returns "ok"
  [ ] Manual smoke test successful
  [ ] Sentry shows no new errors
  [ ] Neon connections stable
  [ ] Stripe webhooks processing

Post-Deploy (first 24h):
  [ ] Monitor error rate every hour
  [ ] Check database query performance
  [ ] Verify email delivery (Resend)
  [ ] Confirm orders are syncing to QB
```

---

## Release Notes Template

Tag each production deploy with a git tag:

```bash
git tag -a v0.2.0 -m "Deployment: April 14, 2026

Features:
  - New pricing intelligence API (/api/builder/pricing-intelligence)
  - Improved auth UX (password strength meter, Caps Lock detection)

Fixes:
  - Fixed race condition in order status updates
  - Corrected margin calculation for NET_30 payment terms

Migration:
  - Added quote_validity_days column to Quote table

Rollback:
  - If needed: vercel promote <previous-deployment-url>
"

git push origin v0.2.0
```

---

## Support & Escalation

**Deployment stuck or broken?**

1. Check Vercel logs: `vercel logs --prod`
2. Check Sentry: https://sentry.io/organizations/abel-lumber
3. Investigate: Is it code, database, or infrastructure?
4. **Escalate to Nate** if unclear: n.barrett@abellumber.com

---

**Last Updated:** April 13, 2026  
**Next Review:** May 13, 2026
