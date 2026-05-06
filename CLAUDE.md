# abel-builder-platform — Repo Instructions for Claude Code

> **Read this first.** This file is loaded automatically by Claude Code when started in this repo. The rules below override anything else unless Nate Barrett explicitly approves an exception in chat.

**Repo:** `abel-builder-platform/`
**Owner:** Nate Barrett (`n.barrett@abellumber.com`)

---

## ⚠️ THIS REPO RUNS A LIVE BUSINESS

The `main` branch of this repo deploys to `app.abellumber.com` and is used **every workday** by:

- **Nate Barrett** (Owner/GM) — full system access
- **Clint Vinson** (COO) — operations dashboard, P&L
- **Dawn Meehan** (Accounting Manager) — AR/AP, payroll, QB sync
- **James Dalton Whatley** (BD Manager) — CRM, leads
- **Robert Sean Phillips** (CX Manager) — customer issues
- **Project Managers**: Chad Zeh, Brittney Werner, Thomas Robinson, Ben Wilson — jobs, BoMs
- **Estimator**: Lisa Adams — quotes
- **Production crew**: Tiffany Brooks, Gunner Hacker, Julio Castro, etc.
- **Drivers**: Austin Collett, Aaron Treadaway, Jack Zenker, Noah Ridge — delivery app

**Breaking `main` breaks payroll, jobs, deliveries, AR/AP, QuickBooks sync, and trust.** Don't break it.

This codebase is internally called **Aegis Supplier**. It's the live production OS for Abel Lumber. Phase 1 turns it into one tenant on a multi-tenant platform — but Phase 1 work happens on the `phase-1` branch only, never `main`.

---

## Hard rules (NON-NEGOTIABLE)

### Branch rules
- **NEVER push to `main`.** Period.
- **NEVER merge `phase-1` → `main`** without Nate's explicit approval *in chat*. PR approval alone is not enough.
- **All Phase 1 work happens on `phase-1` branch only.**
- **Per-PR preview branches** are fine, auto-deployed via Vercel preview, ephemeral DB branches.

### Database rules
- **NEVER run migrations against `prod-main` Neon DB.** That's the live DB.
- All Phase 1 migrations target the `prod-phase-1` Neon branch.
- Migrations are **additive first** (nullable columns, indexes). Destructive migrations only after 7 clean days of parallel-run telemetry **and** Nate's explicit `[NEEDS NATE]` approval.
- Always take a backup before any migration. Backups go to S3 with 30-day retention.

### Deployment rules
- **NEVER deploy to `app.abellumber.com`** without Nate's approval. The cutover from single-tenant to multi-tenant happens once, on a Saturday morning, with a tested rollback path.
- Phase 1 work deploys to `app.aegis.build` (new domain) or per-PR preview URLs.
- Feature flag `MULTI_TENANT_ENABLED` defaults to `false` in prod. The flag flip IS the cutover.

### Smoke test rules
- **Every PR must run the Abel critical-workflows smoke test** (10 workflows: quote, PO, MRP, delivery, install, invoice, payment, customer create, inventory, dashboard load).
- If any smoke test fails, the PR cannot merge. Fix the regression, do not bypass the check.
- The CI workflow `dont-break-abel.yml` is sacred. Don't disable, don't loosen, don't skip.

### Cost rules
- **Default to Sonnet** with prompt caching always on.
- **Opus only with task tag `escalation: true`** and written justification in PR description.
- **Hard budget cap: $400/month API spend.** At 80%, alert Nate. At 100%, freeze.
- Use Claude Max plan for heavy lifting (subscription, not per-token).

### Quality rules
- Type-check, lint, smoke tests must pass before opening a PR
- Cross-fabric review: every PR gets reviewed by a different agent persona before merge
- No secrets in code. 1Password pointer form only: `[1Password: 'aegis/...']`
- Audit log entries for every state-change action
- Mobile-friendly + WCAG 2.2 AA if user-facing

---

## Required reading before any work

In this exact order:

1. `../CLAUDE.md` — workspace memory (Abel context, Nate's preferences, people, security)
2. `../_AEGIS_INDEX.md` — master index of all docs
3. `../Aegis_Architecture_Map.md` — naming and layer architecture
4. `../Phase_1_Task_Queue.md` — the queue you execute against (Safe Build Protocol at the top)
5. `../Aegis_Design_and_UX_Excellence.md` — UI quality bar
6. `../Aegis_Motion_and_Graphics_System.md` — motion + AI-generated graphics
7. `../Aegis_Autonomous_Build_System.md` — Helm + 6 fabrics architecture
8. `../Aegis_AI_Maximization.md` — where AI replaces human work
9. `../Aegis_Agent_Fleet.md` — 76-agent reference
10. `../Claude_Code_Build_Agent_Brief.md` — the operating brief

**Tier 3 docs in workspace root prefixed `Abel_Builder_Platform_*.md` are STALE.** They predate the Aegis rename and the multi-tenant architecture. Do not act on their guidance unless it agrees with the docs above.

---

## Naming discipline

Always use:
- **Aegis Supplier** — the workspace this repo currently powers (Abel's live OS)
- **Aegis Builder** — the new builder-side workspace built in Phase 1
- **Aegis Platform** — the shared multi-tenant foundation
- **Aegis Capital** — embedded fintech

Never use: "Abel OS" (legacy term), "the customer portal," "Aegis" alone (always qualify the layer).

---

## When to stop and ping Nate

| Trigger | Action |
|---|---|
| Any task tagged `[NEEDS NATE]` in the queue | Stop, post comment in PR, wait |
| Any Gate verification step | Stop, tag git, request sign-off |
| Smoke tests fail on `phase-1` PR | Stop, post comment with failure detail |
| Budget hits 80% of $400 cap | Email Nate, await direction |
| Spec ambiguity | Don't guess — ask |
| First production tenant creation for a real customer | Always Nate's call |
| First factoring advance (Aegis Capital v1) | Always Nate's call |
| Touching pricing logic, payment routing, audit log, security middleware | Always Nate's call |
| Anything that would touch `main`, `prod-main`, or `app.abellumber.com` | Stop and refuse — escalate immediately |

---

## What you can do without asking

- Open PRs on `phase-1` branch
- Refactor within a task's scope
- Add tests
- Update internal docs in `docs/` (but not the workspace `Aegis_*.md` files)
- Run migrations against `prod-phase-1` Neon branch (NOT prod-main)
- Spend within budget cap on whitelisted services
- Self-review before merge if smoke tests pass and no `[NEEDS NATE]` flag

## What you cannot do without asking

- Push to `main`
- Disable any CI check
- Migrate `prod-main` DB
- Create real customer tenants in prod
- Send any email to a real customer (DFW outreach approval required)
- Change pricing logic, payment routing, or auth/security middleware
- Add new dependencies without justifying in PR description
- Modify the workspace-level `Aegis_*.md` planning docs
- Touch `agents/` sub-folder CLAUDE.md files **except for T--00 password rotation, which Nate executes manually** — these files govern Fleet A (Abel Ops Fleet, the 6 production agents serving Abel's daily ops). Phase 1 (Fleet B / Aegis Build) does NOT modify them. See `../Aegis_Agent_Fleet_Reconciliation.md` for context.

---

## Communication

- **Daily 7:30am Central briefing** to `n.barrett@abellumber.com` per format in `../Claude_Code_Build_Agent_Brief.md`
- **Friday EOD weekly summary PR** named `phase-1-week-N-summary`
- **Real-time pings** only when smoke tests fail, budget at 80%, or `[NEEDS NATE]` task hits unexpectedly

---

## Working style (from `../CLAUDE.md` — Nate's preferences)

- Concise, lead with the answer
- Show numbers when claiming
- Don't ask before non-destructive work
- Push back if specs have holes
- No sycophancy
- Files are truth — cite which doc
- Tables for comparisons, prose for narrative
- Skip "Great question!" and "I'd be happy to..."

---

## Where to start

Read `../Phase_1_Task_Queue.md` and start with Gate -1, T--01 (safety infrastructure tasks). Until Gate -1 is verified by Nate, no other work begins.

If anything in this file is unclear, **ask Nate before guessing.** The cost of asking is 5 minutes. The cost of breaking Aegis Supplier prod is the entire business.

---

*Last updated: 2026-04-27. This file lives at `abel-builder-platform/CLAUDE.md`. Update only with Nate's explicit approval.*
