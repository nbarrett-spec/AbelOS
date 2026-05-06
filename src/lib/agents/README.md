# `src/lib/agents/` — Sales Agents (Builder Enrichment + Pitch Generator)

Two autonomous Claude-driven agents added 2026-04-30 on `feat/builder-enrichment`.
Both run server-side via Vercel Cron and admin-triggered API routes; neither
replaces the existing `src/lib/claude.ts` staff-AI chat wrapper.

## Files

| Path | Purpose |
|---|---|
| `claude-client.ts` | Shared Anthropic SDK wrapper — prompt caching, tool-use loop, cost tracking |
| `types.ts` | Shared TypeScript types: `EnrichmentResult`, `PitchRunInput`, etc. |
| `enrich-prospect.ts` | Enrichment agent — researches a Prospect via web search + Exa, infers email patterns, writes back to `Prospect` |
| `generate-pitch.ts` | Pitch generator agent — reads BuilderLead + PitchContext, produces HTML microsite via brand voice + element fragments |
| `skills/enrich-criteria.md` | Research playbook (cached as system prompt for enrichment agent) |
| `skills/pitch-voice.md` | Brand voice + messaging pillars (cached as system prompt for pitch agent) |
| `skills/pitch-elements/` | Per-element prompt fragments (cover, pricing, value_eng, etc.) |
| `tools/exa.ts` | Exa.ai people/company search (`EXA_API_KEY` env) |
| `tools/pattern-engine.ts` | Deterministic email pattern detection + application (TS port of `scripts/builder_enrichment/patterns.py`) |
| `tools/deploy-vercel.ts` | Vercel preview deploy for pitch microsites |
| `tools/slack-alert.ts` | Slack incoming-webhook (`SLACK_WEBHOOK_URL` env) — fires on CONFIRMED-tier enrichments |

## Triggers

**Enrichment:**
- Cron: `/api/cron/prospect-enrich` weekly (Mon 7am CT) — re-enriches stale (>30d) or low-confidence Prospects.
- Webhook: `/api/webhooks/resend` bounce → invalidate email + flag for re-research.
- Manual: `/admin/prospects/[id]` "Re-enrich" action.

**Pitch generator:**
- Manual only at MVP: `/admin/pitch-generator` form. Phase 2: auto-trigger on enrichment hitting CONFIRMED.
- Output queues in `ReviewQueue` for Nate's approval per CLAUDE.md hard rule.

## Env vars (add to Vercel project settings)

```
ANTHROPIC_API_KEY                       # already set
EXA_API_KEY                             # NEW — exa.ai (free tier 1K/mo; $10/mo Standard)
SLACK_WEBHOOK_URL                       # NEW — incoming webhook for #sales channel
FEATURE_PROSPECT_ENRICH_ENABLED=true    # default off; flip on after smoke
FEATURE_PITCH_GENERATOR_ENABLED=true    # default off; flip on after smoke
```

## Cost guardrails

- **Per-job hard cap:** $1 (enforced by `makeBudgetGuard` in `claude-client.ts`)
- **Per-day fleet cap:** $20 (enforced by cron handler — counts PitchRun + ProspectEnrich runs in last 24h)
- **80% of $400/mo:** alert per CLAUDE.md hard rule (existing `notifyCronFailure` pattern reused)
- **100%:** freeze enqueueing

## Migration

Schema changes are in `prisma/migrations/add_builder_enrichment_pitch.sql`.
Apply against `prod-phase-1` Neon branch (NEVER `prod-main` per CLAUDE.md):

```bash
psql "$DATABASE_URL_PHASE1" -f prisma/migrations/add_builder_enrichment_pitch.sql
npx prisma generate
```

Then deploy `feat/builder-enrichment` → Vercel preview → smoke test on Garabedian
→ open PR (smoke tests pass + cross-fabric review) → request Nate's chat approval to merge.
