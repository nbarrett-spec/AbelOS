# Element: references

Builder references and case-study snippets. Social proof — but always
under-stated. Lean on Abel's actual customer roster.

## Required content

Pick 2–4 of these depending on the prospect's profile:

- **Brookfield Residential** — current top builder customer; partial
  Hyphen integration; Rev2 plan-breakdown delivered April 2026.
  (Always-on reference for production-builder pitches.)
- **Bloomfield Homes** — active production-builder account, DFW.
- **Lennar / DR Horton / KB Home / Meritage / Taylor Morrison** —
  active accounts; mention 2 max, never all five (looks scattershot).
- **Custom builder roster** — for HERITAGE pitches: pull from Sales
  Pipeline custom builder list (Garabedian, Park, Reynolds Luxury,
  Royal Crest, Goff Custom, etc.) — but only mention if Abel has an
  actual relationship with them.

For each reference:

- Builder name + city
- One-sentence relationship summary ("Production builder in DFW; ~140
  homes/yr; Plan-2450 spec since 2026.")
- Optional pull-quote — only if the user provided one in
  positioningNotes. Never invent a quote.

## Layout & visual

- HERITAGE: 2 reference cards, generous space, optional pull-quote
  styled as a serif block-quote.
- EXECUTIVE: 4 logos in a row (use brand-color text placeholders,
  NOT real builder logos — those need permission). Below the row,
  one-sentence summary per builder.
- BUILDER_FIELD: 1-line bullet list of 3 references with city.

## Logo placeholder pattern

Never hot-link a builder logo. Render as a Walnut-bordered cream box
with the builder name in serif. Pattern:

```html
<div class="reference-logo">{Builder name}</div>
<!-- HUMAN_REVIEW: get permission + drop in actual builder logo before send -->
```

## Voice / brand citations

- `memory/brand/audiences.md` — first-name basis where appropriate
  (e.g., "Amanda Barham at Brookfield" — only if user has explicitly
  authorized name use in positioningNotes).
- `memory/brand/voice.md` — quiet competence; reference list is short
  and specific, never a "logo wall" with 30 builders.

## Hard constraint

**Never publish a builder name as a reference unless it is in
CLAUDE.md as a confirmed Abel customer.** The names allowed:
Brookfield Residential, Bloomfield Homes, Cross Custom Homes
(prospect, not yet a reference), Lennar, DR Horton, KB Home,
Meritage, Taylor Morrison, Perry Homes, Ashton Woods, Highland Homes,
Grand Homes, Trophy Signature.

Pulte/Centex/Del Webb is **off-limits** — that account was lost
2026-04-20. Don't reference them as a current customer.

If the prospect is in a head-to-head competitive context with a name
on this list, swap it out for a different reference — don't out a
competitor.
