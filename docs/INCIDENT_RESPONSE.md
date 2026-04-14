# Abel OS — Incident Response Playbook

**Effective:** April 13, 2026 (Go-Live)  
**Owner:** On-Call Engineer  
**Escalation:** Nate Barrett (n.barrett@abellumber.com)

This document defines severity levels, response procedures, roles, and runbooks for known incident types.

---

## Severity Levels & SLAs

### SEV-1: Critical — Immediate Response (15 min)

**Definition:** Complete outage or data loss affecting all users or system integrity.

**Examples:**
- Site completely down (500 on every request)
- Database unreachable
- Authentication broken for all users
- Unauthorized data access / breach detected
- Payment processing broken

**Response SLA:** 15 minutes to initial mitigation  
**Full Resolution SLA:** 4 hours

**Escalation:**
- [ ] Page on-call engineer immediately
- [ ] Call Nate directly (do not wait for Slack)
- [ ] Post in `#abel-os-launch` Slack channel
- [ ] Declare incident: "SEV-1 declared at {timestamp} UTC"
- [ ] Assign Incident Commander (IC)
- [ ] Notify ops team: start status page updates

### SEV-2: High — Urgent Response (1 hour)

**Definition:** Major feature broken for >1 user or significant degradation.

**Examples:**
- Ordering broken for subset of builders
- Login failing intermittently (>10% of attempts)
- Order confirmation emails not sending
- Stripe webhook failures (orders not synced to QB)
- Database query performance >10s (users experiencing timeouts)

**Response SLA:** 1 hour to mitigation attempt  
**Full Resolution SLA:** 8 hours

**Escalation:**
- [ ] Page on-call engineer
- [ ] Notify Nate (email + Slack)
- [ ] Post in `#abel-os-launch`: "SEV-2 incident: {brief description}"
- [ ] Triage & assign owner within 15 minutes

### SEV-3: Medium — Standard Response (4 hours)

**Definition:** Single user impacted or feature broken with workaround.

**Examples:**
- One builder cannot log in (others can)
- Quote form has data validation bug (users can work around)
- Pricing intelligence API returns incorrect data (fallback pricing works)
- 5xx error on non-critical endpoint

**Response SLA:** 4 hours to initial investigation  
**Full Resolution SLA:** Next business day

**Escalation:**
- [ ] Log in ops backlog
- [ ] Notify feature owner
- [ ] No escalation to Nate unless it escalates to SEV-2

### SEV-4: Low — Non-Urgent (Next Business Day)

**Definition:** Cosmetic, documentation, or minor issue.

**Examples:**
- UI text typo
- CSS misalignment
- Lint warnings
- Non-critical performance (page loads in 3s vs 2s)
- Documentation update needed

**Response SLA:** No SLA; next sprint acceptable  
**Escalation:** None required

---

## Incident Lifecycle

### Phase 1: Detection & Initial Response (First 15 minutes)

1. **Detect:** Alert fires (Sentry, Vercel, monitoring) or user reports issue
2. **Acknowledge:** On-call engineer reads alert immediately
3. **Assess severity:** What's broken? How many users affected? Ongoing data loss?
4. **Declare incident:** Post in Slack with severity level and initial summary
5. **Assign IC (Incident Commander):** Usually the on-call engineer
6. **Triage:** Is it code? Infrastructure? Third-party service?
7. **Communicate:** Update status page (if external-facing incident)

**Template for initial post:**
```
SEV-{1|2|3} INCIDENT DECLARED
Time: {YYYY-MM-DD HH:MM UTC}
IC: @{name}
Issue: {One-sentence summary}
Status: INVESTIGATING
ETA: {estimate}

Details: {Brief description of what's broken}
```

### Phase 2: Investigation & Mitigation (15 min - 4 hours)

1. **Check logs:**
   - Vercel runtime logs: `vercel logs --prod --follow`
   - Sentry error stream: https://sentry.io/organizations/abel-lumber
   - Database metrics: Neon console

2. **Identify root cause:**
   - Code issue? Check recent deployments (git log)
   - Infrastructure? Check Neon, Vercel, Upstash dashboards
   - Third-party? Check Stripe, Resend, Anthropic status pages

3. **Implement mitigation:**
   - Temporary fix: Disable feature flag, scale resources, clear cache
   - Permanent fix: Deploy code fix, database fix, or config change

4. **Verify fix:**
   - Manual smoke test
   - Check error rate trending downward
   - Verify data integrity

5. **Update status page:**
   - Post every 15-30 min for SEV-1/2
   - Keep users informed of progress

### Phase 3: Recovery & Stabilization (4+ hours)

1. **Confirm stability:**
   - Error rate normal for 15+ minutes
   - Performance metrics returning to baseline
   - No ongoing user complaints

2. **Close incident:**
   - Update status page: "Incident Resolved"
   - Post in Slack: "Incident closed at {timestamp}. Details: {summary}"
   - Archive timeline for postmortem

3. **Plan postmortem:**
   - Schedule for within 48 hours
   - Notify all participants
   - Collect logs & timeline

### Phase 4: Postmortem & Learning (Within 48 hours)

1. **Write postmortem:**
   - What happened?
   - Timeline of events
   - Root cause
   - Impact (users, revenue, duration)
   - What we're changing to prevent recurrence

2. **Assign follow-up tasks:**
   - Code fix (if not already deployed)
   - Documentation update
   - Test case addition
   - Monitoring improvement

3. **Share learning:**
   - Post postmortem in `#engineering` Slack channel
   - Update runbooks based on findings
   - Schedule knowledge share session (if interesting incident)

---

## Incident Commander Role

**Who:** Typically the on-call engineer who detected the issue.

**Responsibilities:**
1. Triage severity and declare incident
2. Coordinate team (engineer, Scribe, Comms)
3. Make go/no-go decisions on mitigations
4. Keep the timeline moving (escalate if stuck)
5. Update status page every 15-30 minutes (SEV-1/2)
6. Schedule postmortem meeting
7. Ensure incident is marked closed

**Authority:** IC has authority to:
- Escalate to Nate
- Deploy emergency fixes without full review
- Disable features to stabilize
- Scale infrastructure resources

**Deescalation:** IC can downgrade severity if initial assessment was too high:
- SEV-1 → SEV-2 if "Most users unaffected" becomes clear
- SEV-2 → SEV-3 if workaround is easy

---

## Incident Roles

### Incident Commander (IC)
- Leads triage and mitigation
- Makes severity & escalation calls
- Coordinates team
- Owns timeline accuracy

### Scribe
- Records timeline (Slack thread or shared doc)
- Captures decisions & actions
- Tracks who did what when
- Provides postmortem draft

### Comms / Status Page
- Updates status page every 15-30 min
- Posts Slack updates
- Prepares customer communication (if needed)
- Collects user reports of recovery

### Engineer(s)
- Investigates root cause
- Implements fix
- Verifies mitigation
- Runs integrity checks post-incident

---

## Communication Template

### Initial Incident Declaration

```
🚨 SEV-2 INCIDENT DECLARED

Time: 2026-04-15 14:30 UTC
IC: @alice
Issue: Ordering broken for subset of builders

Status: INVESTIGATING
Current ETA: 15:30 UTC

What we know:
- ~30% of builders unable to place orders
- Error: "Invalid quote pricing" 500 error
- Issue started ~10 min ago

What we're doing:
- Checking Vercel logs for recent changes
- Verifying database connectivity
- Reviewing Stripe webhook status

Updates every 15 min. More details: [link to postmortem doc]
```

### Status Update (Ongoing)

```
UPDATE: 14:45 UTC

Found: Pricing intelligence API returning null values
Impact: Quote creation downstream depends on this
Cause: Under investigation (API timeout or bug)

Mitigation: Disabling pricing intelligence feature, using fallback prices
ETA: 15:00 UTC for fix deployment
```

### Incident Closed

```
✅ INCIDENT RESOLVED: 15:15 UTC

Root Cause: Anthropic API timeout in pricing intelligence; fallback logic not triggered
Mitigation: Deployed fix to use fallback pricing when API slow
Duration: 45 minutes
Impact: ~30 builders unable to order for ~45 min; ~12 orders blocked (manually placed post-resolution)

Postmortem: [link]
Action items: [link to tracking]
```

---

## Playbooks for Known Incidents

### Incident: High Error Rate / 500 Spike

**Trigger:** Sentry alert >10 errors/min or >5% of requests returning 500

**Triage (5 min):**
```bash
# Check logs
vercel logs --prod | grep 500 | head -20

# Identify pattern
# Are 500s on same endpoint? Different endpoints? Random?

# Check recent deployment
git log --oneline | head -5
# When was latest deploy?

# Check infrastructure
# Neon: Connection count? Query latency?
# Upstash: Memory usage? Rate limit being hit?
# Vercel: Any function errors?
```

**Root Cause Possibilities:**
1. **Code bug in recent deploy** → Revert via `vercel rollback`
2. **Database slow/overloaded** → Kill long-running query, scale tier
3. **Rate limiter stuck** → Flush Upstash Redis
4. **External API timeout** (Stripe, Anthropic) → Add timeout handling, use fallback
5. **Memory leak in function** → Redeploy or upgrade Vercel tier

**Mitigation (10-15 min):**
- If code issue: `vercel rollback` to last known-good deployment
- If DB issue: Check Neon console, kill slow query, scale if needed
- If external: Timeout + fallback behavior; alert service owner

**Recovery:**
- Monitor error rate for 10+ minutes
- Verify orders are still being created correctly
- Check customer emails for complaints

---

### Incident: Login Failing (All Users)

**Trigger:** Sentry alerts on auth routes, or Slack report "Can't log in"

**Triage (2 min):**
```bash
# Test login manually
curl -s https://app.abellumber.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Check if middleware is correct
cat src/middleware.ts | grep -A 5 "builderAuthRoutes"

# Check if JWT_SECRET matches
# (Can't actually check secret, but verify env var exists)
```

**Root Cause Possibilities:**
1. **JWT_SECRET rotated recently** → Expected; users must re-login
2. **Middleware bug** → Check git diff src/middleware.ts
3. **Neon database down** → Check Neon status page
4. **Vercel deployment failed** → Check Vercel dashboard
5. **Build error during deploy** → Check Vercel build logs

**Mitigation (5-10 min):**
- If DB down: Wait for Neon recovery or restore from snapshot
- If middleware bug: Rollback recent changes
- If secret rotated: Expected behavior; communicate to users
- If deploy failed: Check error log and fix, then redeploy

**Verification:**
- Try login manually via browser
- Check Sentry for auth errors
- Confirm cookies are being set (`Set-Cookie` header)

---

### Incident: Database Connection Pool Exhausted

**Trigger:** Neon alert "Connection limit exceeded" or Vercel logs show "ECONNREFUSED"

**Triage (2 min):**
1. **Check Neon console:**
   - Active connections: Should be <50 in steady state
   - Connections trending up? Staying at limit?
   - Any long-running queries?

2. **Check Vercel logs:**
   ```bash
   vercel logs --prod | grep -i "connection\|pool\|ECONNREFUSED"
   ```

3. **Identify offending route:**
   - Is one endpoint spawning many connections?
   - N+1 query problem?
   - Handler not closing connections?

**Mitigation (5-10 min):**
- **Kill long-running query:**
  ```sql
  -- Neon console SQL editor
  SELECT pid, query, duration FROM pg_stat_activity 
  WHERE state = 'active' ORDER BY duration DESC;
  
  SELECT pg_terminate_backend(pid) 
  WHERE duration > 30000; -- Kill queries >30s
  ```

- **Update DATABASE_URL connection pool size** (if configurable):
  ```
  postgresql://...?maxConnections=50&idleConnectionTimeout=15
  ```

- **Scale Neon tier temporarily:**
  - Neon console → Branch settings → Upgrade compute tier
  - This gives more capacity while investigating

- **Identify code issue:**
  ```bash
  git log --oneline src/app/api/ | head -5
  # Any recent changes to heavily-used endpoints?
  ```

**Recovery:**
- Monitor active connections returning to normal
- Verify requests completing successfully
- Deploy fix once identified (close connections in handler)

---

### Incident: Order Data Corruption / Inconsistency

**Trigger:** Report of duplicate line items, wrong totals, or missing statuses

**Triage (10 min):**
1. **Identify affected orders:**
   ```bash
   # Via Prisma Studio (if accessible)
   npm run db:studio
   # Query Order table for affected orders by date/builder
   ```

2. **Assess scope:**
   - How many orders affected?
   - What data is corrupted?
   - When did corruption start?

3. **Check logs for patterns:**
   - Stripe webhook logs (double-firing?)
   - Cron job logs (if recent scheduled task)
   - Vercel function errors (race condition?)

**Root Cause Possibilities:**
1. **Race condition:** Two requests updating same order simultaneously
2. **Webhook double-fire:** Stripe webhook delivered twice (idempotency bug)
3. **Migration issue:** Schema change didn't update all rows
4. **Seed data conflict:** Import conflicted with existing data

**Mitigation (30-45 min):**
- **Restore from backup:**
  - Neon console → Branch → Snapshots
  - Restore to pre-incident snapshot
  - This resets DB to known-good state (data after snapshot is lost)

- **Manual correction (if isolated):**
  ```bash
  npm run db:studio
  # Query affected order
  # Manually fix status, line items, totals
  ```

- **Replay webhooks (if webhook issue):**
  - Stripe dashboard → Webhooks → select failed event → Resend

**Recovery:**
- Run integrity checks: `npx tsx prisma/integrity-checks.ts`
- Verify all affected orders are correct
- Communicate timeline to affected builders
- Document root cause & prevention

---

### Incident: Memory Leak / Slow Performance

**Trigger:** Vercel Functions timing out, or Sentry performance alerts

**Triage (5 min):**
1. **Check Vercel metrics:**
   - Function duration: Trending up?
   - Memory usage: At limit?
   - Check specific function logs

2. **Check Sentry Performance tab:**
   - Slow transactions
   - Database query latency

3. **Profile locally (if reproducible):**
   ```bash
   npm run dev
   # Use Chrome DevTools → Performance → Record → Reproduce issue
   ```

**Root Cause Possibilities:**
1. **Unbounded loop:** Prisma query returning too many rows
2. **N+1 queries:** Loop querying DB for each item
3. **Missing index:** Database query scan instead of seek
4. **Unclosed resource:** Database connection, file handle, etc.

**Mitigation:**
- **Reduce dataset size:** Use `take: 100` on Prisma queries
- **Add database index:** `@@index([fieldName])` in schema.prisma
- **Paginate results:** Return first N results, require user to paginate
- **Cache results:** Upstash Redis for frequently-accessed data
- **Upgrade compute:** Neon or Vercel tier (temporary while investigating)

**Long-term fix:**
- Deploy code fix + test case
- Monitor performance post-deploy
- Update performance baseline

---

### Incident: Payment Processing Broken

**Trigger:** "Payment failed" errors, or orders not transitioning to PAID status

**Triage (5 min):**
1. **Check Stripe dashboard:**
   - Recent payment attempts (Payments section)
   - Webhook events (filter by timestamp)
   - Any errors or failures?

2. **Check Sentry:**
   - Filter: `webhook` or `stripe`
   - Any signature verification errors?
   - Payment intent creation errors?

3. **Check database:**
   ```bash
   npm run db:studio
   # Query Order table for recent orders
   # Check paymentStatus, stripePaymentIntentId, etc.
   ```

**Root Cause Possibilities:**
1. **Stripe API key invalid:** Secret key expired or rotated
2. **Webhook signature invalid:** STRIPE_WEBHOOK_SECRET mismatched
3. **Insufficient funds:** Customer card declined (not our issue, but inform customer)
4. **Stripe outage:** Check Stripe status page
5. **Code bug:** Payment intent creation logic broken

**Mitigation (5-10 min):**
- **Verify Stripe credentials:**
  - Vercel dashboard → Env vars → confirm STRIPE_SECRET_KEY & STRIPE_WEBHOOK_SECRET
  - If out of date, rotate and redeploy

- **Resend failed webhook events:**
  - Stripe dashboard → Webhooks → select event → "Resend"
  - This retriggers order fulfillment

- **Temporary: Disable online payments:**
  - Set feature flag: `FEATURE_DISABLE_STRIPE=true`
  - Tell customers to call for manual payment processing
  - Redeploy

**Recovery:**
- Verify customers' payments succeeded (Stripe balance)
- Check orders transitioned to PAID correctly
- Communicate payment status to affected builders
- Invoice manually if needed (temporary workaround)

---

## Postmortem Template

Save as `/incidents/postmortem-{YYYY-MM-DD}-{title}.md`

```markdown
# Postmortem: {Incident Title}

**Date:** {YYYY-MM-DD}  
**Start:** {HH:MM UTC} — **End:** {HH:MM UTC} — **Duration:** {X min}  
**Severity:** SEV-{1|2|3}  
**Incident Commander:** {Name}  
**Attendees:** {Names}  

## Summary

{1-2 sentence high-level summary}

## Timeline

| Time | Event |
|------|-------|
| 14:30 | Sentry alert fires: 50 errors in 5 min |
| 14:35 | IC declares SEV-2; engineer starts investigation |
| 14:40 | Root cause identified: Pricing API returning null |
| 14:45 | Fallback pricing enabled; deploy started |
| 15:00 | Deploy complete; error rate returning to baseline |
| 15:15 | Incident closed; all orders processing normally |

## Root Cause Analysis

### Primary Cause
{What actually went wrong? Be specific.}

Example: Anthropic API timeout in pricing-intelligence endpoint. Fallback logic existed but was behind a feature flag that wasn't enabled.

### Contributing Factors
1. {Factor 1}
2. {Factor 2}
3. {Factor 3}

## Impact

- **Duration:** 45 minutes
- **Users affected:** ~30 builders
- **Orders blocked:** 12 (manually resolved post-incident)
- **Revenue impact:** $0 (orders placed after recovery; no actual loss)
- **Severity assessment:** Correct (SEV-2)

## What Went Well

- [ ] Fast alert detection (within 5 min)
- [ ] Clear communication in Slack
- [ ] IC quickly escalated decision-making
- [ ] Rollback was available as fallback plan

## What Could Be Better

- [ ] Feature flag should have been enabled by default
- [ ] No integration test for fallback pricing logic
- [ ] Timeout handling was not documented in code

## Action Items

| Item | Owner | Due |
|------|-------|-----|
| Add integration test for pricing fallback | @alice | 2026-04-20 |
| Document timeout handling in README | @bob | 2026-04-17 |
| Enable pricing intelligence by default (not behind flag) | @alice | 2026-04-15 |
| Add Anthropic API timeout monitoring to Sentry | @charlie | 2026-04-22 |

## Questions & Discussion

- Should we increase Anthropic API timeout from 5s to 10s?
- Do we need circuit breaker pattern for external APIs?
- Should we mirror pricing data locally (vs. calling API every time)?

## Follow-up Meetings

- [ ] Architecture review: External API resilience (scheduled 2026-04-17)
- [ ] Runbook update: Pricing failures (scheduled 2026-04-16)

---

**Approved by:** {IC Name}  
**Date:** {YYYY-MM-DD}  
```

---

## Post-Incident Checklist

After every SEV-1 or SEV-2:

- [ ] Postmortem written within 48 hours
- [ ] Action items assigned + due dates set
- [ ] Root cause documented in runbook
- [ ] Test case added to prevent recurrence
- [ ] Monitoring/alerting improved
- [ ] Team notified of findings + action items
- [ ] Follow-up meeting scheduled (if architectural issue)

---

## Escalation Tree

```
User reports issue
  ↓
On-call engineer investigates
  ↓
SEV-1 or SEV-2?
  ├─ YES → Page Nate + declare incident
  └─ NO → Continue investigation
  ↓
  Unable to resolve within SLA?
  ├─ YES → Escalate to Nate + entire team
  └─ NO → Continue
```

**Nate's contact info:**  
- Slack: @nate.barrett
- Email: n.barrett@abellumber.com
- Phone: [Check with Nate for on-call number]

---

## References

- **README & RUNBOOK:** docs/RUNBOOK.md for service dashboards & access
- **DEPLOY:** docs/DEPLOY.md for rollback procedures
- **SECURITY:** docs/SECURITY.md for incident response policies

---

**Last Updated:** April 13, 2026  
**Next Review:** May 13, 2026
