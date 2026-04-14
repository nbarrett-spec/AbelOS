# Abel OS — Go-Live Runbook

**Owner:** Nate Barrett
**Effective:** April 13, 2026
**Applies to:** `app.abellumber.com` production environment

This runbook covers the first 72 hours post-launch. Keep it open while the team logs in Monday morning.

---

## At-a-glance system map

| Component | What | Where to check |
|---|---|---|
| Frontend + API | Next.js 14 on Vercel | Vercel dashboard — project `prj_MjzBjjhzkWkI4LpEEgwZ4VaClSE8` |
| Database | Neon Postgres | Neon console → Abel OS production branch `main` |
| Auth | Stytch | Stytch dashboard → Abel OS project |
| Order data source | InFlow | InFlow web admin (Nate has owner access) |
| Accounting sync | QuickBooks | IntegrationConfig table + QBSyncQueue |
| Email | Stytch transactional + [TODO: confirm SMTP provider] | |
| DNS | [TODO: confirm — Cloudflare?] | |

---

## Key dashboards to watch (first 72h)

1. **Vercel runtime logs** — `vercel logs --prod --follow` (or dashboard "Logs" tab). Watch for 500s and slow routes.
2. **Neon metrics** — Connection count (should stay <50), query latency, storage growth.
3. **Stytch events** — Login successes/failures by day.
4. **`/api/ops/health`** (if exposed) — app-level healthcheck.

---

## First 24 hours — what to watch

| Time | Action | Who |
|---|---|---|
| T+0h | Seed data import complete, all integrity checks ✓ | Claude Code |
| T+0h | Tag release `go-live-2026-04-13` | Claude Code |
| T+0h | Trigger welcome emails for first 3 pilot builders ONLY (Pulte, DR Horton, BROOKFIELD) | Nate |
| T+1h | Manual smoke test — login, order list, dashboard | Nate |
| T+2h | Invite staff to log in (Jessica, Amanda, Linda first) | Nate |
| T+4h | Review Vercel logs for 500s | Amanda |
| T+8h | Approve remaining 9 builder welcomes | Nate |
| T+24h | Morning check: new-order count, error rate, support inbox | Amanda |

---

## Known risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Password reset email doesn't reach Outlook/Exchange tenant | Medium | Ask builder to check spam. If still nothing, manually reset via admin. |
| InFlow sync job double-counts after seed | Low | Seed doesn't touch Order table. Verify `last_sync_at` unchanged before enabling cron. |
| Stytch OAuth flow breaks on MCP first use | Low | Run once from Nate's machine before team onboarding. |
| Neon connection pool exhaustion under load | Low | Current limit 100 concurrent. Monitor first day; upgrade tier if needed. |
| Someone accidentally commits Abel_OS_Seed_Data.xlsx | Medium | `.gitignore` has it + pre-commit hook would be nice (Phase 2 improvement) |

---

## Incident response

**Step 1 — Assess severity**

| Severity | Definition | Response time |
|---|---|---|
| SEV-1 | Site down for all users / data loss | 15 min |
| SEV-2 | Core feature broken (ordering, login) for >1 builder | 1 hour |
| SEV-3 | Single user/feature broken, workaround exists | 4 hours |
| SEV-4 | Cosmetic or minor | Next business day |

**Step 2 — Declare + communicate**

- SEV-1 / SEV-2: Call Nate immediately. Post in `#abel-os-launch` Slack (when created). Update `/status` page if we have one.
- SEV-3 / SEV-4: Log in the ops backlog, notify owner.

**Step 3 — Triage**

1. Check Vercel → Deployments → is the latest deploy still `READY`?
2. Check Vercel → Runtime logs for errors in the last 15 min
3. Check Neon → is the DB reachable? Any connection spike?
4. Check Stytch → auth events, any spike in failures?

**Step 4 — Mitigate**

| Situation | Fix |
|---|---|
| Latest deploy broke prod | `vercel rollback` to previous ready deployment in Vercel dashboard |
| DB query storm | Neon console → Check queries tab → kill offending session |
| Rogue seed row corrupting a view | Use `prisma/seed-log-2026-04-13.json` to find the ID, manual delete |
| Data catastrophe | Restore `pre-seed-april-13-2026` snapshot + Vercel rollback to `af06780` (nuclear option) |

**Step 5 — Postmortem**

Within 48 hours of any SEV-1 or SEV-2, write a blameless postmortem:
- What happened?
- Timeline
- Root cause
- Impact (users affected, duration)
- What we're changing so it doesn't happen again

---

## Rollback paths

### Level 1 — single record
Find the record ID in `prisma/seed-log-2026-04-13.json` and manually delete.

### Level 2 — one sheet's worth
Delete by creation timestamp:
```sql
DELETE FROM "Deal" WHERE "createdAt" > '2026-04-13 06:00:00' AND "createdAt" < '2026-04-13 09:00:00';
```
(Adjust timestamp window to match your import run.)

### Level 3 — full DB restore
1. Neon console → Branches → `pre-seed-april-13-2026` → Restore to main
2. Vercel → Deployments → redeploy commit `af06780`
3. Notify team the system is being rolled back
4. Post-mortem within 24h

### Level 4 — Vercel-only rollback (code bug, data OK)
1. Vercel dashboard → Deployments → find last known good deploy → "Promote to Production"
2. No DB changes needed

---

## Vendor & integration contacts

| Vendor | Contact | Account |
|---|---|---|
| Vercel | support.vercel.com | Team `team_N5vS62239hTNtmmr6aSyzijl` |
| Neon | support@neon.tech | Project: Abel OS |
| Stytch | support.stytch.com | Project: Abel OS |
| InFlow | support.inflowinventory.com | Abel Lumber owner account |
| QuickBooks | Intuit support line | Abel Lumber company |

---

## Post-launch week 1 checklist

- [ ] Day 1: Pilot builders onboarded (3 accounts)
- [ ] Day 2: Remaining 9 builder welcomes sent
- [ ] Day 3: All 13 staff logged in successfully
- [ ] Day 4: First live order flows end-to-end (placed → confirmed → shipped → invoiced)
- [ ] Day 5: Accounting reconciles first invoice batch against QuickBooks
- [ ] Day 7: Review error logs, close out launch period, write retro

---

## Hardening backlog (fix post-launch)

1. Move 21st.dev API key to env var (`MAGIC_API_KEY`)
2. Pin `@21st-dev/magic` to a specific version
3. Add pre-commit hook to block `Abel_OS_Seed_Data.xlsx` from being committed
4. Set up Sentry or equivalent error monitoring
5. Add `/api/health` endpoint if it doesn't exist
6. Schedule regular Neon snapshots (weekly → monthly cadence)
7. Document the MCP setup in `docs/mcp-setup.md` for new teammates
8. Rotate Stytch project secrets 90d from launch
