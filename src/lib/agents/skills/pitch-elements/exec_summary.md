# Element: exec_summary

The "if they only read one section, this is it" block. Three to five
short paragraphs OR a stat strip + one paragraph. Reader can put the
microsite down here and have everything that matters.

## Required content

- One opening line that names what's actually being proposed (not
  generic "Abel is excited to share…"). Examples:
  - "We can replace your current door + trim spec on Plan 2450 at $1,290
    less per home, on an 8-day lead time."
  - "For The Reserve, Abel quotes 8 species, one PO, 24-hour RFQ turn."
- 3–5 bullet metrics — each with a number from real data. Pull from:
  - `estBuildVolume` (e.g., "200 homes/year × $14k material spend")
  - Abel constants: 96% on-time rate, 53% gross margin, 6
    manufacturers on one PO, 41 years, ~10,000 doors delivered DFW
  - Vendor swap delta if `currentVendor` is known
- Closing line that names the next step with a date.

## Layout & visual

- HERITAGE: prose-led, two short paragraphs, one pull-quote at the end.
- EXECUTIVE: 3-column metric strip (`.stat` + `.stat-label`), then a
  150-word paragraph below.
- BUILDER_FIELD: 5-bullet list, each ≤14 words. No prose paragraph.

## Voice / brand citations

- `memory/brand/voice.md` "Lead with the number" + "One-sentence
  paragraphs hit."
- `memory/brand/messaging-pillars.md` — every bullet should map to one
  of the six pillars. If you can't map it, cut it.
- BANNED: "We are excited", "leverage", "best-in-class", "industry-
  leading", "thrilled."

## Data caveat

If you don't have a number for a claim, mark it
`[X% — pending data confirm]` with a `<!-- HUMAN_REVIEW -->` comment.
Never invent percentages or dollar amounts.
