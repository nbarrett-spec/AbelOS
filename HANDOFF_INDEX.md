# Abel OS — Claude Code Handoff Index

**Go-live:** April 13, 2026
**Owner:** Nate Barrett
**Purpose:** Single entry point for every file Claude Code (or a human) needs to finish the data build and ship Abel OS.

---

## Start here

**→ `SETUP_STEPS.md`** — the 6-step checklist. Read this first. Everything else is referenced from there.

If you have 60 seconds, read `SETUP_STEPS.md` and stop. If you have 10 minutes, read `SETUP_STEPS.md` → `CLAUDE_CODE_HANDOFF.md`.

---

## The deliverables (what each file is for)

| # | File | What it is | When you need it |
|---|---|---|---|
| 1 | `SETUP_STEPS.md` | Nate's 6-step pre-handoff checklist | First. Do these before opening Claude Code. |
| 2 | `CLAUDE_CODE_HANDOFF.md` | Full 7-phase execution brief for Claude Code | Claude Code reads this first. Contains the one-shot prompt. |
| 3 | `Abel_OS_Seed_Data.xlsx` | 128-row seed workbook (staff, vendors, products, builders, pricing, templates, deals, contracts, projects) | Phase 3 (dry run + import) |
| 4 | `seed-from-xlsx.ts` | TypeScript import script — idempotent upserts, dry-run flag, per-row logging | Phase 3. Drop into `prisma/`. |
| 5 | `integrity-checks.ts` | 10 post-seed verification checks as runnable TS | Phase 5. Run via `npx tsx`. |
| 6 | `email-templates/` (7 files) | README + 6 templates (welcome, pw reset, order confirm, ship notice, invoice, past-due) | Phase 4. Seed into Stytch via MCP. |
| 7 | `GO_LIVE_RUNBOOK.md` | First-72h ops reference: dashboards, risks, incident response, rollback paths | Launch day + week 1 |

All files live in this folder (`Abel Lumber/`).

---

## Recommended reading order

### For Nate (you)
1. `SETUP_STEPS.md` — your 6 things
2. `GO_LIVE_RUNBOOK.md` — skim the incident response + rollback sections so you know where to look if something breaks
3. That's it. Claude Code handles the rest.

### For Claude Code (handoff prompt will direct it)
1. `CLAUDE_CODE_HANDOFF.md` — full brief
2. `Abel_OS_Seed_Data.xlsx` — the data
3. `prisma/schema.prisma` — the models
4. `prisma/seed-from-xlsx.ts` — the script
5. `prisma/integrity-checks.ts` — the verification
6. `email-templates/*.md` — Stytch MCP input for Phase 4
7. `GO_LIVE_RUNBOOK.md` — rollback reference if anything breaks

---

## Where files land in the repo

```
abel-builder-platform/
├── Abel_OS_Seed_Data.xlsx          ← from this folder (gitignored)
├── CLAUDE_CODE_HANDOFF.md          ← from this folder
├── GO_LIVE_RUNBOOK.md              ← from this folder
├── prisma/
│   ├── schema.prisma               ← already exists
│   ├── seed-from-xlsx.ts           ← from this folder
│   └── integrity-checks.ts         ← from this folder
└── docs/
    └── email-templates/            ← copy entire folder
```

---

## Rollback quick reference

| Severity | Action |
|---|---|
| Single bad row | Use `prisma/seed-log-2026-04-13.json` to find the ID, manual delete |
| Whole sheet | Delete by creation timestamp (see `GO_LIVE_RUNBOOK.md` Level 2) |
| Catastrophic | Neon restore `pre-seed-april-13-2026` snapshot + Vercel rollback to `af06780` |
| Code-only bug | Vercel "Promote to Production" on last good deploy |

Full procedures in `GO_LIVE_RUNBOOK.md`.

---

## What's not in the handoff (intentionally)

- **DNS changes** — Cloudflare (or whoever) cutover is a Nate-manual step, done before Claude Code runs
- **Stytch project secrets** — already in Vercel env, not in any handoff file
- **Production database URL** — in Vercel env, Claude Code doesn't hardcode it
- **InFlow API keys** — already in IntegrationConfig table
- **Real customer data (deals, contracts)** — workbook has realistic placeholders; Nate corrects in SETUP_STEPS.md step 1 before import

---

## Open questions for Nate (answer before Claude Code runs)

1. Which SMTP provider is sending transactional mail — Stytch built-in or a separate provider? (`GO_LIVE_RUNBOOK.md` TODO)
2. DNS provider — Cloudflare? (`GO_LIVE_RUNBOOK.md` TODO)
3. Company mailing address for invoice template? (`email-templates/05-invoice.md` TODO)
4. Are all 13 staff emails accurate in the workbook, or do any need correction before seed? (SETUP_STEPS.md step 1)

Answer in-line in the relevant files or just tell Claude Code at handoff time.

---

## Success criteria

By end of go-live day, all true:

- [ ] Seed import completed; 128 rows created, 0 failed
- [ ] All 10 integrity checks pass (0 rows on the hard-fail queries)
- [ ] Nate can log in as each of 3 pilot builders without errors
- [ ] Stytch has all 6 email templates loaded
- [ ] First welcome email sent and received
- [ ] Neon snapshot `pre-seed-april-13-2026` confirmed retained
- [ ] Release tagged `go-live-2026-04-13`
- [ ] `GO_LIVE_RUNBOOK.md` open in a browser tab for the next 72h
