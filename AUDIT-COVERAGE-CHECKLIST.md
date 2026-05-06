# Audit Coverage — Wrap-up Checklist

**Branch:** `claude/audit-coverage`
**Coverage:** 100.0% (494/494 state-changing routes)
**Status:** Type-check clean, ready for PR.

Walk through this top to bottom. Each step is 1–2 minutes.

---

## ✅ 1. Verify the work locally (5 min)

```bash
cd abel-builder-platform
git checkout claude/audit-coverage

# Should print 100.0% coverage, 0 missing
npx tsx scripts/audit-coverage-sweep.ts | head -12

# Should exit 0 (no type errors)
npx tsc --noEmit && echo "OK"

# Sanity-check one patched route
cat src/app/api/agent-hub/inventory/auto-po/route.ts | head -15
# Expect: import { withAgentHubAudit } + export const POST = withAgentHubAudit(...)
```

If any check fails, **stop and ping Claude** before merging.

---

## ✅ 2. Smoke-test in dev (5 min)

```bash
npm run dev
# In another terminal:

# Hit any state-changing route — logout is safest:
curl -X POST http://localhost:3000/api/auth/logout -i

# Confirm a row landed:
psql $DATABASE_URL -c "SELECT action, entity, severity, \"createdAt\" FROM \"AuditLog\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Expect at least one row with `action = 'LOGOUT'` and severity `INFO`.

---

## ✅ 3. Open the PR (2 min)

```bash
git push -u origin claude/audit-coverage

gh pr create --title "Audit coverage to 100%" --body "$(cat <<'EOF'
## Summary
- Coverage 78.9% → 100.0% across all 494 state-changing API routes
- 0 CRITICAL gaps remaining (was 19)
- Three reusable shims so future routes audit by default:
  - `src/lib/cron.ts` instrumentation auto-audits all crons
  - `src/lib/agent-hub/audit-shim.ts` → `withAgentHubAudit(handler)`
  - `src/lib/audit-route.ts` → `withAudit(handler)` (generic)

## Verify
- [ ] `npx tsx scripts/audit-coverage-sweep.ts` shows 100%
- [ ] `npx tsc --noEmit` exits 0
- [ ] Smoke test: `POST /api/auth/logout` writes a `LOGOUT` row to `AuditLog`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Don't merge until preview deploy + smoke test on Vercel preview URL.**

---

## ✅ 4. Add the CI guard (10 min — high-leverage)

Prevents coverage from regressing. New file:

**`.github/workflows/audit-coverage.yml`**

```yaml
name: Audit coverage gate

on:
  pull_request:
    paths:
      - 'src/app/api/**'
      - 'src/lib/audit*.ts'
      - 'src/lib/cron.ts'
      - 'src/lib/agent-hub/audit-shim.ts'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: Audit coverage must be 100%
        run: |
          npx tsx scripts/audit-coverage-sweep.ts > /tmp/sweep.md
          missing=$(grep -oE 'MISSING audit\(\) \*\*\| \*\*[0-9]+\*\*' /tmp/sweep.md | grep -oE '[0-9]+')
          echo "Missing: $missing"
          if [ "$missing" != "0" ]; then
            cat /tmp/sweep.md
            exit 1
          fi
```

Commit on `phase-1` branch (per project rules — never directly to `main`).

---

## ✅ 5. Watch table growth for one week (2 min/day)

Daily check during week 1 of merge:

```sql
SELECT
  date_trunc('day', "createdAt") AS day,
  COUNT(*) AS rows_added,
  pg_size_pretty(pg_total_relation_size('"AuditLog"')) AS total_size
FROM "AuditLog"
WHERE "createdAt" >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

**Expect:** 10K–50K rows/day.
**If >100K/day:** add an archival cron (see step 6).

---

## ⏳ 6. (Optional) Add monthly archival — only if step 5 shows growth pain

New file: `src/app/api/cron/auditlog-archive/route.ts`

Pattern: move rows older than 90 days to S3, then `DELETE FROM "AuditLog" WHERE "createdAt" < NOW() - INTERVAL '90 days'`. Schedule monthly in `vercel.json`.

Skip for now unless table size becomes an actual problem.

---

## ⏳ 7. (Optional) Build the CRITICAL audit feed

The `/admin/audit-history` page exists but doesn't filter by severity. Quick win:

**`src/app/admin/audit-critical/page.tsx`** — list `WHERE severity IN ('WARN', 'CRITICAL')` last 7 days, group by entity, click-through to detail. ~30 min of work; high signal for SOC reviewers.

---

## Reference

| File | Purpose |
|---|---|
| `AUDIT-COVERAGE-REPORT.md` | Latest sweep output (regenerate any time) |
| `scripts/audit-coverage-sweep.ts` | Re-runnable coverage sweep |
| `scripts/apply-agent-hub-shim.ts` | Idempotent — re-run if new agent-hub routes show up unaudited |
| `scripts/apply-generic-audit-shim.ts` | Idempotent — re-run on any new bare-route POST/PATCH/etc. |
| `src/lib/audit.ts` | Core `audit()`, `auditBuilder()`, `logAudit()` |
| `src/lib/cron.ts` | Auto-audits every cron via `startCronRun`/`finishCronRun` |
| `src/lib/agent-hub/audit-shim.ts` | `withAgentHubAudit(handler)` HOF |
| `src/lib/audit-route.ts` | Generic `withAudit(handler)` HOF |

---

## Stop conditions

If at any point:
- The sweep reports <100% coverage **and you didn't expect it** → review the diff before merging
- Type-check fails → don't merge
- Smoke-test produces no AuditLog row → check that the AuditLog table exists in the target DB (it self-heals via `ensureTable()`, but check for permission errors in logs)

Cost of asking before merging: 5 min.
Cost of broken audit in prod: SOC/legal/insurance pain.
