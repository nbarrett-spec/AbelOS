# Abel OS — Claude Code Handoff Brief

**Date:** April 13, 2026 (GO-LIVE DAY)
**Environment:** `app.abellumber.com` (production, Vercel + Neon Postgres)
**Repo:** `abel-builder-platform/`
**Last green deploy:** `dpl_7DRR9PiVQfzZ3KK2yTpywCRch4pS` (commit `af06780`)

---

## The one-shot prompt to paste into Claude Code

Copy everything between the fences below, paste into Claude Code (running in the `abel-builder-platform/` directory), and hit enter.

```
You are taking over Abel OS seed data import on GO-LIVE DAY.

Read these files in order before doing ANYTHING:
1. /absolute/path/to/Abel Lumber/CLAUDE_CODE_HANDOFF.md  (this brief — full context, phases, SQL checks, rollback)
2. /absolute/path/to/Abel Lumber/Abel_OS_Seed_Data.xlsx  (pre-populated seed data — 11 sheets)
3. prisma/schema.prisma  (58-model data model — the source of truth for field names and enums)

Your job: execute the 7 phases in CLAUDE_CODE_HANDOFF.md end-to-end.

Non-negotiables:
- Take the Neon snapshot named "pre-seed-april-13-2026" before Phase 3 import
- Always run `--dry-run` first and show me the summary before committing
- Use `upsert` on unique fields so the importer is idempotent
- Log every inserted/updated record ID to `prisma/seed-log-2026-04-13.json` for rollback
- Do NOT commit `Abel_OS_Seed_Data.xlsx` to git (add to `.gitignore`)
- Do NOT touch InFlow order data — that was cleaned up in the previous session
- Rotate the Neon database password in Phase 7 and update Vercel env vars

When you hit a decision point (open questions list in the brief, or anything ambiguous), STOP and ask me. Don't guess on production.

Start with Phase 1. Report back after the dry-run in Phase 3 and I'll greenlight the commit.
```

Replace the two `/absolute/path/to/...` placeholders with the real paths on your machine before pasting. On Windows, they'll look like:
- `C:\Users\nbarrett\...\Abel Lumber\CLAUDE_CODE_HANDOFF.md`
- `C:\Users\nbarrett\...\Abel Lumber\Abel_OS_Seed_Data.xlsx`

---

## What's already done (context Claude Code needs)

- Vercel deploy is green as of commit `af06780` — TypeScript errors in `AgentWorkflow` route and `sales/reminders` route are resolved
- InFlow order cleanup executed: 48 stale orders moved to COMPLETE, 2 payment status fixes. Order table is clean.
- `.mcp.json` staged in repo root with 21st.dev Magic + Stytch MCP servers (gitignored)
- `ui-ux-pro-max` skill installed at `.claude/skills/ui-ux-pro-max/` (also gitignored)
- API keys are currently hardcoded in `.mcp.json` — hoist to env vars in Phase 7

---

## What's in the seed workbook

`Abel_OS_Seed_Data.xlsx` — 11 sheets, fully populated, all realistic Abel Lumber data:

| Sheet | Rows | Notes |
|---|---|---|
| README | — | Overview & rules |
| Enums | 10 types | Reference for StaffRole, DealStage, PaymentTerm, etc. |
| Staff | 13 | Full Abel org — Nate (CEO) + sales, ops, PMs, accounting, logistics |
| Vendors | 10 | DW Distribution, Boise Cascade, Masonite, JELD-WEN, Therma-Tru, Emtek, Kwikset, Schlage, LP, Metrie |
| Products | 30 | Interior doors (12), exterior doors (3), trim (7), hardware (8) |
| Builders | 12 | Pulte, BROOKFIELD, Lennar, DR Horton, KB Home, Meritage, Taylor Morrison, Perry, Ashton Woods, Highland, Grand, Trophy Signature |
| BuilderPricing | 21 | Custom pricing for top 5 builders |
| OrderTemplates | 6 | Standard packages for DR Horton (2), Pulte (2), BROOKFIELD, Lennar |
| Deals | 8 | Active pipeline: $2.5M aggregate; stages PROSPECT → CLOSED_LOST |
| Contracts | 7 | 6 signed + 1 sent; $10.7M estimated annual volume |
| Projects | 10 | Active subdivisions across top 5 builders |

**Nate — before handoff, walk through each sheet and correct:**
- Staff phones, emails, hire dates, hourly rates
- Builder contact names + phones (placeholders)
- Product costs & prices (align to actual InFlow catalog)
- Vendor account numbers
- Deal amounts, close dates, owner assignments

---

## Inputs (file paths Claude Code will reference)

| File | Location |
|---|---|
| Seed workbook | `Abel Lumber/Abel_OS_Seed_Data.xlsx` |
| This brief | `Abel Lumber/CLAUDE_CODE_HANDOFF.md` |
| Prisma schema | `abel-builder-platform/prisma/schema.prisma` |
| Existing seed scripts (reference only) | `abel-builder-platform/prisma/seed.ts`, `seed-real-data.ts` |
| Env (DATABASE_URL) | `abel-builder-platform/.env` |

---

## 7-Phase Execution Plan

### Phase 1 — Pre-flight (5 min)
1. `cd abel-builder-platform`
2. `git status && git log -1` — verify on `main` at `af06780` or newer
3. Confirm `.env` → `DATABASE_URL` points at prod Neon
4. **Neon snapshot**: console → branches → create snapshot `pre-seed-april-13-2026`
5. `npx prisma generate`

### Phase 2 — Build the import script (30–45 min)
Create `prisma/seed-from-xlsx.ts`:

```typescript
// Dependencies (add if missing): xlsx, bcrypt, @prisma/client
// Usage:
//   npx tsx prisma/seed-from-xlsx.ts --dry-run
//   npx tsx prisma/seed-from-xlsx.ts
```

Implementation requirements:
- Read the workbook with the `xlsx` npm package, sheet by sheet
- Import in FK-safe order: **Staff → Vendors → Products → Builders → BuilderPricing → OrderTemplates → Deals → Contracts → Projects**
- Use `prisma.<model>.upsert()` on these unique keys:
  - Staff: `email`
  - Vendors: `code`
  - Products: `sku`
  - Builders: `email`
  - BuilderPricing: composite `(builderId, productId)`
  - OrderTemplates: composite `(builderId, name)` — add @@unique if missing
  - Deals: `dealNumber` (generate as `DEAL-2026-####` if blank)
  - Contracts: `contractNumber` (generate as `CTR-2026-####` if blank)
  - Projects: composite `(builderId, name)` — add @@unique if missing
- For Staff/Builder password handling:
  - If `initialPassword` column is populated → `bcrypt.hash(password, 10)`
  - If blank → generate a crypto-random `resetToken` with 48h expiry; do NOT send emails in this script (that happens separately once Nate approves)
- For OrderTemplates.items parsing: `"SKU:qty;SKU:qty"` → resolve each SKU to productId, create OrderTemplateItem rows
- For Deals.ownerEmail → lookup Staff.id; fail loudly if owner not found
- Write a per-row log: `{ sheet, row, action: 'created'|'updated'|'skipped'|'failed', id, reason? }` to `prisma/seed-log-2026-04-13.json`
- At the end, print a summary table: sheet / created / updated / failed

### Phase 3 — Dry run → review → execute (15 min)
```bash
npx tsx prisma/seed-from-xlsx.ts --dry-run
```
Review the summary with Nate. If clean:
```bash
npx tsx prisma/seed-from-xlsx.ts
```

### Phase 4 — System config (20 min)
- **Email templates** via Stytch MCP (`createEmailTemplate`): welcome, password-reset, order-confirmation, ship-notice, invoice, past-due. Use the `brand-voice-enforcement` skill to apply Abel tone.
- **Notification rules**: seed defaults in the Notification config for: new-order (all ops), stale-deal 14d (deal owner), overdue-invoice 7d (accounting).
- **Dashboard KPI targets**: leave `AccountMarginTarget` / `AccountCategoryMargin` empty unless Nate provides numbers. Dashboard should gracefully handle no-target.
- **IntegrationConfig**: verify InFlow + QuickBooks credentials are still valid. Don't re-enter them.

### Phase 5 — Integrity checks (15 min)
Run these via `prisma.$queryRaw` or Neon SQL editor. Report counts back to Nate:

```sql
-- Expected: 0 rows everywhere (except where noted)
SELECT d.id, d."companyName" FROM "Deal" d
  LEFT JOIN "Staff" s ON s.id = d."ownerId" WHERE s.id IS NULL;

SELECT sku, COUNT(*) FROM "Product" GROUP BY sku HAVING COUNT(*) > 1;

SELECT sku, name, cost, "basePrice" FROM "Product" WHERE cost > "basePrice";

SELECT id, email FROM "Staff" WHERE department IS NULL OR role IS NULL;

SELECT id, "contractNumber", title FROM "Contract"
  WHERE "builderId" IS NULL AND "dealId" IS NULL;

-- Active builders with zero deals/orders — expected: new Builders with no InFlow history
SELECT b.id, b."companyName" FROM "Builder" b
  LEFT JOIN "Order" o ON o."builderId" = b.id
  LEFT JOIN "Deal" d ON d."builderId" = b.id
  WHERE o.id IS NULL AND d.id IS NULL AND b.status = 'ACTIVE';
```

### Phase 6 — Smoke test (10 min)
1. Log in as `n.barrett@abellumber.com` — dashboard should load
2. Log in as `m.johnson@abellumber.com` (sales) — should see 3 deals (Bloomfield, Normandy, Couto)
3. Trigger builder password reset for `sarah.chen@pulte.com` — verify token generates and email renders
4. Click through: Builder list → Pulte detail → Canyon Ridge project → Plan 2450 template → OrderTemplate items render with correct pricing
5. Create a test order as Pulte (via admin impersonation), verify ops routing, then delete it

### Phase 7 — Wrap up (10 min)
1. Commit `seed-from-xlsx.ts`, the seed-log JSON, and the updated `.gitignore` (which should now include `Abel_OS_Seed_Data.xlsx`)
2. Create `docs/go-live-runbook.md` with: how to roll back, how to check Vercel logs, who to page, InFlow/QB sync monitoring
3. **Hoist the 21st.dev API key**: edit `.mcp.json` to `"API_KEY": "${MAGIC_API_KEY}"` and set `MAGIC_API_KEY` in Nate's shell profile. Pin `@21st-dev/magic@latest` to a specific version.
4. **Rotate Neon password**: Neon console → Roles & Databases → reset. Update `.env` locally AND in Vercel (`vercel env add DATABASE_URL production`). Redeploy.
5. Final commit + tag: `git tag go-live-2026-04-13 && git push --tags`

---

## Rollback plan

| Severity | Action |
|---|---|
| Single bad record | `prisma seed-log-2026-04-13.json` → find ID → manual delete in reverse FK order |
| Bad batch (one sheet) | Delete by sheet — e.g., `DELETE FROM "Deal" WHERE "createdAt" > '2026-04-13 06:00:00'` |
| Catastrophic | Neon console → restore `pre-seed-april-13-2026` snapshot. Vercel → redeploy commit `af06780`. |

---

## Open questions Nate should answer BEFORE Claude Code starts

These are baked into the prompt as "stop and ask" gates, but resolve them up front if possible:

1. **Existing data collision** — are there ANY Builder/Staff/Product rows in prod Neon already? If yes, should the seed upsert (update) or skip?
2. **Welcome emails** — send immediately on Builder insert, batch later with Nate's approval, or never (Nate sends manually)?
3. **Deal CLOSED_WON → Builder promotion** — auto-create the Builder record when a Deal closes won, or require manual conversion?
4. **Initial passwords** — force-reset-on-first-login (generate token + welcome link) is the default. Any exceptions?

---

## Hardening TODOs (DO in Phase 7, don't skip)

1. Move 21st.dev API key to env var
2. Pin 21st.dev version (no more `@latest`)
3. Rotate Neon password
4. Add `docs/mcp-setup.md` for future teammates

---

## Contact & quick reference

- Vercel project: `prj_MjzBjjhzkWkI4LpEEgwZ4VaClSE8` / team `team_N5vS62239hTNtmmr6aSyzijl`
- Neon project: Abel OS production — pause/branch controls in console
- InFlow: Nate has owner access
- GitHub repo: abel-builder-platform (main branch, direct-to-main allowed for Nate)

**Don't ship anything destructive without written confirmation from Nate.**
