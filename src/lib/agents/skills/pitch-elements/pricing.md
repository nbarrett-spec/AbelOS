# Element: pricing

A schedule the builder can read in 30 seconds and forward to their PM.
Always a `<table>`, never bullet prose.

## Required content

- If `targetPlans` is provided in PitchContext: per-plan COGS, one row
  per plan. Columns: Plan name, SqFt, Door count (if known else
  blank), Trim LF (if known), Current spec $, Abel spec $, Δ $, Lead
  time (days).
- If `targetPlans` is empty: show the 6-manufacturer Abel ladder
  instead. Columns: Manufacturer, Tier, Door type, Lead time, Notes.
  Manufacturers in fixed order: Masonite, Therma-Tru, ProVia,
  Plastpro, JELD-WEN, Codel.
- A table footer row showing total annual spend if `estBuildVolume` is
  known: `{volume} homes × {avgUnitCost} = {totalAnnual}`.
- Footnote line below the table: "Pricing valid through {today + 30
  days}. Subject to Abel order minimum and current Boise / Masonite /
  Therma-Tru list." Cite source: "Abel OS production logs, April 2026"
  for any volume claim.

## Layout & visual

- Standard table styling from brand-token block: th uppercase, Kiln
  Oak, letter-spacing 0.04em. tbody rows with alternating Walnut 4%
  tint.
- Right-align the dollar columns; tabular-nums for stat figures.
- Δ $ column: positive savings in Walnut, neutral in Charcoal, premium
  upcharge (when Abel costs more) in Oxblood — never red. Builder-VE
  voice: don't apologize for premium where it's earned.
- BUILDER_FIELD style: table is the entire section, no prose.
- HERITAGE style: only show pricing if `targetPlans` is rich enough to
  justify it; otherwise prefer to soft-pitch with a "samples on
  request" note.

## Voice / brand citations

- `memory/brand/audiences.md` "Production builders" — "Per-plan cost
  delta (dollars, not percentages)."
- `memory/brand/voice.md` — numbers > adjectives.

## Data caveat

**You don't have catalog access.** Treat all unit prices as
placeholders. Render them as `$XX,XXX` with a
`<!-- HUMAN_REVIEW: confirm against Abel catalog -->` comment per cell
that holds an invented number. Better to under-spec than ship a real
table with fake numbers — Nate will refuse to send fabricated pricing.
If `targetPlans` rows include `materialBudget`, you can use that
verbatim — that's user-supplied, not invented.
