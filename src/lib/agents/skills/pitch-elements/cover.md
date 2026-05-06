# Element: cover

A `<header>` block at the top of the microsite. Builder-recognizable in
two seconds.

## Required content

- Builder-side identity slot: a `<div class="builder-logo-slot">`
  with the literal placeholder text `[Builder logo — drop in PNG]` if
  no logo URL is available. Never hot-link a guessed logo URL.
- Abel logo reference: `<div class="abel-logo">Abel Doors & Trim</div>`
  rendered as a wordmark in `--font-display` Walnut on Cream until a
  real logo asset is wired. Add HTML comment:
  `<!-- HUMAN_REVIEW: replace wordmark with /abel-logo.svg before send -->`
- City + state in small caps if both are known (e.g.,
  `WESTLAKE, TEXAS`). Skip silently if either is missing.
- Headline (≤9 words, ≤7 if HERITAGE/EXECUTIVE): pattern is
  `{companyName} × Abel — door, trim, hardware partnership`
  for the default, OR a more pillar-led variant if you have positioning
  notes. Voice rule: lead with the number when you can. Examples:
  - HERITAGE: "Westlake craft, on a Gainesville lead time."
  - EXECUTIVE: "Plan 2450, 8-day lead time, locked through Q4."
  - BUILDER_FIELD: "Doors, trim, hardware — one PO, eight-day lead."
- Subheadline / dek (one sentence, ≤20 words): the proof point that
  earns the headline. Cite a real number if you have one
  (`estBuildVolume`, Abel's 96% on-time rate, lead-time deltas).

## Layout & visual

- Full-bleed Walnut `#3E2A1E` background, Cream `#F3EAD8` text. OR
  cream background with subtle Walnut wordmark — pick one based on
  style.
- HERITAGE: cream background, big serif headline, big margin.
- EXECUTIVE: walnut background, cream type, tight grid.
- BUILDER_FIELD: skip the cover block entirely if elements list does
  not include `cover`. If included, keep it minimal — one row, name +
  date.
- Reserve top-right corner for a date stamp in `--text-muted`
  (`Today's date: <today>`). Use ISO-like `Apr 30, 2026`.

## Voice / brand citations

- `memory/brand/visual-identity.md` "Logo usage" — minimum clear space
  = 1× logo height; never tint or stretch.
- `memory/brand/voice.md` "Length and cadence" — deck slide headline
  ≤6 words; we're slightly looser at ≤9 for microsite hero, but never
  more.
- BANNED: "Welcome to", "Thank you for considering Abel", any
  exclamation point.
