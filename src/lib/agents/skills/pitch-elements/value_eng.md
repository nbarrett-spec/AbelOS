# Element: value_eng

3–5 specific substitution proposals vs. the builder's likely current
spec. Each one with: what's being changed, why it's a fit, and the $/
unit savings. The Brookfield VE proposal is the structural reference.

## Required content

For each proposal (3–5 total):

- Substitution headline: "Swap A → B for {save_per_unit}" pattern.
  Examples: "Swap MDF panel interior → primed Masonite shaker for
  $42/door."
- Why it's the right move: 2 sentences of plain-English builder
  rationale (durability, lead time, warranty, finish quality).
- Per-unit savings (or premium): show the $ amount.
- Plan-level rollup: per-home savings × `estBuildVolume` annual.
- Risk / caveat: any honest reason this swap might not work — show
  the risk before the builder asks.

## Layout & visual

- BUILDER_FIELD: numbered list, each entry a tight card with
  headline + 2-line rationale + $ in the right gutter.
- EXECUTIVE: 2-column grid of cards, with a Chart.js bar chart at the
  end showing top 5 swaps by total annual savings.
- HERITAGE: omit unless explicitly requested. Custom builders usually
  don't VE — they spec for craft, not cost.

## Voice / brand citations

- `memory/brand/voice.md` — quiet competence; show the risk before
  the builder asks. "Banks (and builders) trust operators who name the
  risks before they do" (audiences.md, bankers section, but applies
  here too).
- `memory/brand/messaging-pillars.md` Pillar 3 — Craft over commodity.
  Don't VE Abel's craft away just to win on price.

## Data caveat

**Critical — you don't have product catalog or spec data.** Every
substitution headline must be flagged as a proposal, not a quote.
Render the savings as `[~$XX/door — pending Abel catalog confirm]`
with `<!-- HUMAN_REVIEW: validate substitution + price against current
catalog before send -->` comment per swap.

If the user provided `positioningNotes` that mentions specific
substitutions Abel has already validated, use those verbatim — Dalton
or Nate would have written them based on real catalog work. Do NOT
extrapolate beyond what's in the notes.

Three safe placeholder swap categories that are almost always real
(use these as defaults if no specifics are given):
1. Interior door panel: 6-panel hollow → 2-panel shaker (style upgrade,
   negligible cost)
2. Hardware: builder-grade lever → Emtek/Schlage F-Series with same
   finish (premium, $/door upcharge — frame as VE benefit not savings)
3. Trim: stock 2¼" colonial casing → 3¼" craftsman MDF (often a
   savings if going from finger-jointed pine to MDF, mild premium if
   going to solid-stain-grade)
