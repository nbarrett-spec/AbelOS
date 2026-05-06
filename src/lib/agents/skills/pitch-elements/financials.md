# Element: financials

Financial stability proof. Used most heavily for EXECUTIVE-style
banker contexts and large-builder procurement reviews where credit
exposure matters. For pure builder pitches, trim to 1–2 numbers.

## Required content

Pick 3–5 of these (style-dependent):

- **53% gross margin** — Abel's GM band, sourced from 2026 financials.
  Pillar 3 evidence.
- **41 years in business** — operating continuously since 1984.
- **Hancock Whitney line** — primary banking relationship; line
  renewal April 2026. (Don't share line size publicly — keep the
  framing to "longstanding HW relationship.")
- **Zero customer concentration risk above XX%** — placeholder
  number (HUMAN_REVIEW); the storyline is no single builder >
  threshold of revenue.
- **Boise Cascade primary supplier** — multi-vendor optionality
  preserved (Masonite, JELD-WEN, Therma-Tru, ProVia, Plastpro,
  Codel) — supply diversification is real, not theoretical.
- **DSO trend** — placeholder; the storyline is "improving DSO via
  Abel OS automation since April 2026 cutover."
- **Audited financials available under NDA** — closing line for
  banker contexts.

## Layout & visual

- EXECUTIVE: full-width Chart.js block (line chart of GM% over 3+
  years if data available, else a static stat strip).
- HERITAGE: skip OR reduce to a single line: "41 years, zero balance-
  sheet drama. Audited financials available."
- BUILDER_FIELD: skip entirely — PMs don't read financial sections.

## Voice / brand citations

- `memory/brand/audiences.md` "Bankers" — formal but not stiff,
  numbers-dense, footnoted, name the risks before they ask.
- `memory/brand/messaging-pillars.md` Pillar 3 (53% GM) + Pillar 6
  (operational leverage).
- `memory/brand/voice.md` BANNED: "exciting growth," "explosive,"
  "best-in-class financials."

## Data caveat

**This element handles sensitive numbers — be conservative.** If the
user passes specific financial numbers in `positioningNotes`, use
those verbatim. If not, use only the public-safe constants (53% GM,
41 years, HW relationship, 6-vendor diversification) and mark
everything else as `[X — under NDA]`. Better to invite a credit
review than to publish specific cash-position numbers in a microsite
URL.

Cite source on every number rendered, in a Kiln Oak `--fs-12`
footnote: "Source: Abel internal financials, FY2026 (April 2026
close)."
