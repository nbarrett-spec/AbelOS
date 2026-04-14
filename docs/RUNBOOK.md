# Abel OS — On-Call Runbook

**Effective:** April 13, 2026 (Go-Live)  
**Audience:** On-call engineers, support team  
**Emergency Contact:** Nate Barrett — n.barrett@abellumber.com

This runbook covers daily operations, incident response, and troubleshooting for Abel OS production environment (app.abellumber.com).

---

## System Map & Dashboards

### Primary Services

| Service | Purpose | Access | Status Check |
|---------|---------|--------|--------------|
| Vercel (Hosting) | Frontend + API | https://vercel.com/teams/abel-lumber | `vercel status` or dashboard |
| Neon (Database) | PostgreSQL serverless | https://console.neon.tech | Connection pool, query metrics |
| Sentry (Errors) | Runtime error tracking | https://sentry.io/organizations/abel-lumber | Error rate dashboard |
| Upstash (Rate Limit) | Redis (shared state) | https://console.upstash.com | Memory usage, request latency |
| Stripe (Payments) | Payment processing | https://dashboard.stripe.com | Event logs, balance |
| Resend (Email) | Transactional email | https://resend.com | Delivery metrics, bounce rate |

### Health Check Endpoints

```bash
# App-level health check (no auth required)
curl -s https://app.abellumber.com/api/health
# Response: { "status": "ok", "db": true, "sentry": true, "upstash": true }

# Builder portal smoke test (requires valid session)
curl -s https://app.abellumber.com/api/account/health \
  -H "Cookie: abel_session=<token>"

# Ops staff health check
curl -s https://app.abellumber.com/api/ops/health \
  -H "Cookie: abel_staff_session=<token>"
```

---

## Logging In to Services

### Vercel Dashboard
```bash
# Check deployments, logs, environment variables
vercel link
vercel logs --prod --follow

# Or via web: https://vercel.com/teams/abel-lumber/abel-builder-platform
# Project ID: prj_MjzBjjhzkWkI4LpEEgwZ4VaClSE8
```

### Neon Console (Database)
1. Go to https://console.neon.tech
2. Project: Abel OS
3. Branch: `main` (production)
4. Check: Connections, query performance, storage

### Sentry (Error Tracking)
1. https://sentry.io/organizations/abel-lumber
2. Project: `abel-builder-platform`
3. Filter by environment: `production`
4. View: Issues, Performance, Releases

### Upstash Redis Console
1. https://console.upstash.com
2. Database: `abel-os-ratelimit`
3. Monitor: Commands/sec, memory usage, latency

---

## Daily Checks (First Thing in Morning)

### 1. Check Vercel Deployment Status
```bash
vercel status
# Or:
curl -s https://app.abellumber.com/api/health | jq .
```

Expected: HTTP 200, all services `true`.

### 2. Check Sentry Error Rate
1. Open https://sentry.io/organizations/abel-lumber
2. Filter: `environment:"production"` & last 24h
3. **Alert threshold:** >5 errors/hour is abnormal

### 3. Check Database Connectivity
```bash
# Via Neon dashboard:
# - Check "Active Connections" (should be <50 in steady state)
# - Check "Top Queries" for slow queries (>1s)
```

### 4. Check Email Delivery
1. Resend dashboard → Emails
2. Bounce rate should be <2%
3. Look for failed campaigns (usually password resets, order confirmations)

### 5. Check Stripe Webhook Events
1. https://dashboard.stripe.com/webhooks
2. Filter: last 24h
3. Look for failed webhook deliveries (red ✗ icons)

---

## Viewing Logs

### Vercel Runtime Logs
```bash
# Follow production logs in real-time
vercel logs --prod --follow

# Tail last 100 lines
vercel logs --prod | tail -100

# Filter by path or status
vercel logs --prod --follow | grep -E "500|/api/orders"
```

### Sentry Event Stream
1. Sentry → Issues → pick issue
2. Scroll to "All Events" tab
3. Click event to see full context: stack trace, user ID, request headers, breadcrumbs

### Database Query Logs (Neon)
1. Neon console → main branch
2. "Insights" tab → "Queries"
3. Sort by duration to find slow queries
4. Kill offending session if needed: `SELECT pg_terminate_backend(pid) WHERE state='active' AND duration > 30s`

---

## Common Troubleshooting

### Symptom: High Error Rate / 500s Spike

**Step 1 — Assess scope:**
```bash
vercel logs --prod --follow | grep 500 | tail -10
# Count errors by endpoint
vercel logs --prod | grep 500 | awk '{print $NF}' | sort | uniq -c
```

**Step 2 — Check Sentry for pattern:**
- Same route? Different routes?
- Database errors or API errors?
- Auth errors or data errors?

**Step 3 — Check Infrastructure:**
```bash
# Neon: Active connections spiking?
# Upstash: Request rate / memory usage?
# Stripe webhook: Any failures?
```

**Step 4 — Mitigate:**
- If latest deploy is broken: `vercel rollback` to previous deployment
- If database is hot: Kill long-running queries in Neon console
- If rate limiter is stuck: Flush Upstash Redis key

### Symptom: Login Failing (All Users)

**Check in order:**
1. Is JWT_SECRET rotated recently? (Cookie parser may mismatch)
2. Are auth middleware routes matching? (`/login` → should be public, `/dashboard` → should require session)
3. Check Sentry for auth errors: `category:auth`
4. If Neon down: Try to connect via psql (check Neon status page)

**Workaround (manual password reset):**
```bash
# Via Prisma Studio
npm run db:studio
# Query: SELECT id, email FROM "Builder" WHERE email='user@example.com'
# Manually update passwordHash to test value (hash = bcrypt(password, 12))
# Then tell user to reset password
```

### Symptom: Slow API / Timeouts

**Check query performance:**
1. Neon console → Insights → Queries → Sort by duration
2. Look for N+1 queries (same query run multiple times)
3. Check for missing indexes on frequently-filtered columns

**Check rate limiter:**
```bash
# Upstash console: Is memory usage >80%?
# If so, flush old keys: FLUSHDB in console
```

**Temporary mitigation:**
- Add caching layer (Redis or in-memory) for hot queries
- Increase Neon compute tier temporarily
- Scale Vercel Functions (auto-scales, but check if hitting limits)

### Symptom: Email Not Sending

**Check Resend delivery logs:**
1. Resend console → Emails
2. Filter by recipient email
3. Check bounce reason: hard bounce (invalid), soft bounce (temp), delivery fail

**For password resets:**
- Resend may be blocking Outlook/corporate exchanges
- Workaround: Use admin portal to manually reset password, or tell user to check spam

**For order confirmations:**
- Check builder email in database — is it valid?
- Resend logs show rejection reason

### Symptom: High Database Connection Count

**Cause:** Usually a route handler not closing connections properly.

**Diagnosis:**
```bash
# Neon: Check "Active Connections" and which PIDs are connected
# Vercel: Check `vercel logs` for routes that are spawning many connections
```

**Mitigation:**
```bash
# Check Prisma client reuse (should be single instance)
# See src/lib/prisma.ts
cat src/lib/prisma.ts

# If needed, update pool size in DATABASE_URL
# Example: ?maxConnections=25
```

---

## Running Integrity Checks

After seed, migrations, or suspect data issue:

```bash
# Post-seed data quality check (19 checks)
npx tsx prisma/integrity-checks.ts

# Expected output:
# ✓ Check 1: orphan_deals — 0 found
# ✓ Check 2: duplicate_skus — 0 found
# ✓ Check 3: negative_margin_products — 0 found
# ... (16 more)
# ✅ All 19 checks passed (exit code 0)
```

If any check fails (exit code 1), investigate before proceeding:
- `orphan_deals` → Find and delete stranded Deal records
- `duplicate_skus` → Merge or delete duplicates
- `negative_margin_products` → Update costs or base prices

---

## Rotating JWT_SECRET

**Why:** Periodically rotate signing key for security.

**Impact:** All existing sessions become invalid; users must re-login.

**Process:**
```bash
# 1. Generate new secret
openssl rand -base64 48

# 2. Update Vercel environment variable
# Via dashboard: Settings → Environment Variables → JWT_SECRET
# Set to new value

# 3. Trigger new deployment
git commit --allow-empty -m "chore: rotate JWT_SECRET"
git push
# Vercel auto-deploys

# 4. Monitor Sentry for auth errors (should spike briefly as sessions expire)

# 5. Announce to team: "JWT rotation complete. Please re-login."
```

---

## Flushing Rate Limiter Cache

If rate limiter is misbehaving (false positives, stuck keys):

```bash
# Upstash console → Your Database → Run command
FLUSHDB

# Or via Redis CLI (if installed locally):
redis-cli -u $UPSTASH_REDIS_REST_URL FLUSHDB
```

**Note:** This clears ALL rate limit state. Users will reset their request counts immediately.

---

## Re-Seeding in Emergency

**Only do this if data is corrupted and you have no backups.**

```bash
# 1. Backup current DB (Neon console → Branches → take snapshot)

# 2. Clear existing data (careful!)
npx prisma migrate reset --force
# This runs all migrations from scratch

# 3. Re-seed
npm run db:seed

# 4. Run integrity checks
npx tsx prisma/integrity-checks.ts

# 5. Test manually
npm run dev
# Visit http://localhost:3000/login
# Try login with test builder (email from seed)

# 6. Deploy to production (if needed)
git push
# Vercel auto-deploys
```

---

## Feature Flags & Toggles

Currently: No feature flags implemented. Planned for Phase 2.

**For now, to toggle a feature:**
1. Update environment variable in Vercel dashboard
2. Redeploy (or wait for next auto-deploy)
3. Code checks `process.env.FEATURE_FLAG_NAME` at request time

Example:
```bash
# In Vercel dashboard, set:
FEATURE_DISABLE_PRICING_INTELLIGENCE=true

# In route handler:
if (process.env.FEATURE_DISABLE_PRICING_INTELLIGENCE === 'true') {
  return NextResponse.json({ error: 'Feature disabled' }, { status: 503 })
}
```

---

## Incident Response

### Quick Severity Assessment

| Severity | Example | Response Time | Escalation |
|----------|---------|---|---|
| **SEV-1** | Site down for all users, data loss, auth broken everywhere | 15 min | Call Nate immediately |
| **SEV-2** | Core feature broken (ordering, login) for >1 builder | 1 hour | Page on-call, notify Nate |
| **SEV-3** | Single user or feature broken, workaround exists | 4 hours | Log ticket, notify owner |
| **SEV-4** | Cosmetic, documentation, minor bug | Next business day | Backlog |

### First 10 Minutes Checklist (SEV-1/2)

- [ ] **Call Nate** (immediate for SEV-1)
- [ ] **Check deployment:** Is latest Vercel deploy `READY`? Any recent pushes?
- [ ] **Check logs:** `vercel logs --prod --follow` for error pattern
- [ ] **Check infrastructure:** Neon connections? Upstash health? Stripe webhooks?
- [ ] **Declare in Slack:** `#abel-os-launch` — "SEV-{1|2} incident declared. Time: {timestamp}. IC: {your name}"
- [ ] **Establish command:** IC (Incident Commander), Scribe (document), Comms (update status page)

### Runbooks for Known Incidents

#### Incident: Database Connection Pool Exhausted
**Symptom:** Requests timeout, Neon shows >100 active connections  
**Root cause:** Probably a handler not closing connections or N+1 query loop  
**Fix:**
1. Check Neon "Insights" → identify offending query
2. Kill the long-running session: `SELECT pg_terminate_backend(pid) WHERE ...`
3. Investigate route code (Prisma client reuse?)
4. Upgrade Neon tier temporarily if under load
5. Deploy fix once identified

#### Incident: Auth Tokens Invalid (Mass Login Failures)
**Symptom:** All login attempts fail with "Invalid token" or redirect loops  
**Root cause:** Could be JWT_SECRET rotation, middleware bug, or expired cookie format change  
**Fix:**
1. Check Vercel env vars — was JWT_SECRET changed?
2. Check middleware.ts for recent changes (git log src/middleware.ts)
3. If secret rotated recently, that's expected — guide users to re-login
4. If unexpected, revert recent deploy: `vercel rollback`

#### Incident: Order Data Corruption
**Symptom:** Orders show wrong amounts, duplicate line items, or missing status  
**Root cause:** Race condition, webhook double-firing, or migration bug  
**Fix:**
1. Identify affected orders (search by date range, builder ID)
2. Restore from Neon snapshot (pre-incident) if available
3. Manual correction via `prisma studio` if isolated
4. Run integrity checks post-fix
5. Investigate root cause (webhook, migration, race condition?)

#### Incident: Stripe Webhook Delivery Failing
**Symptom:** Orders placed but not synced to QB; invoices not created  
**Root cause:** Webhook endpoint returning 5xx, or signature validation failing  
**Fix:**
1. Check Stripe dashboard → Webhooks → Failed events
2. Verify webhook endpoint is responding (check Vercel logs)
3. Check Sentry for webhook handler errors
4. Manually replay failed events: Stripe dashboard → select event → "Resend"

#### Incident: Email Delivery Stopped (No Password Resets Sent)
**Symptom:** Users report no reset emails arriving; Resend shows high bounce  
**Root cause:** Bad SMTP config, Resend API key expired, domain reputation issue  
**Fix:**
1. Check Resend dashboard — is API key valid?
2. Check DKIM/SPF records for noreply@abellumber.com (Resend docs)
3. Check bounce list — any blocklisted domains?
4. Temporary workaround: Admin-initiated password reset via `/ops` portal
5. Contact Resend support if persistent

---

## Postmortem Template

Write within 48 hours of any SEV-1/2 incident. Save to `/incidents/postmortem-{date}.md`.

```markdown
# Postmortem: {Incident Title}
**Date:** {YYYY-MM-DD}  
**Duration:** {start-time} to {end-time} UTC  
**Severity:** SEV-{1|2}  
**IC:** {Name}

## Summary
{1-2 sentence summary of what happened and impact}

## Timeline
- **14:30** — First error alert in Sentry
- **14:35** — SEV-2 declared, IC assigned
- **14:45** — Root cause identified: ...
- **15:00** — Fix deployed
- **15:15** — All systems green, incident closed

## Root Cause
{Why did this happen? What system/code/process failed?}

## Impact
- **Duration:** 45 minutes
- **Users affected:** ~50 builders
- **Orders blocked:** 12
- **Revenue impact:** $X (if applicable)

## What Went Well
- {Fast alert detection}
- {Clear escalation path}

## What Didn't Go Well
- {Slow triage}
- {Missing runbook step}

## Action Items (Prevention)
1. [ ] Add monitoring for {specific metric} (Owner: {Name})
2. [ ] Add integration test for {code path} (Owner: {Name})
3. [ ] Document {procedure} in runbook (Owner: {Name})
4. [ ] Upgrade {infrastructure} (Owner: {Name})

## Discussion
{Optional: Lessons learned, follow-up calls, questions}
```

---

## Contact Tree

**Primary on-call:** Check Nate's Slack status or calendar  
**Backup on-call:** [TBD — to be assigned by Nate]  
**Escalation:** Nate Barrett — n.barrett@abellumber.com

**Slack channels:**
- `#abel-os-launch` — Incident declarations & updates
- `#platform-eng` — General engineering discussions
- `#ops-alerts` — Automated alerts (Sentry, Vercel, Neon)

---

## Additional Resources

- **Vercel Docs:** https://vercel.com/docs
- **Neon Docs:** https://neon.tech/docs
- **Sentry Docs:** https://docs.sentry.io/product/
- **Prisma Docs:** https://www.prisma.io/docs/
- **Stripe Webhooks:** https://stripe.com/docs/webhooks
- **Resend Docs:** https://resend.com/docs

---

**Last Updated:** April 13, 2026  
**Next Review:** May 13, 2026 (30 days post-launch)
