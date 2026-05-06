# Element: team

Who at Abel the prospect would actually work with. Faces > org chart.
This is a relationship pitch, not an HR section.

## Required content

3–5 team cards, in this order:

- **Nate Barrett** — Owner / GM. `n.barrett@abellumber.com`. Strategy,
  big-customer accounts, system design.
- **Clint Vinson** — COO + co-owner. Operations lead.
- **James Dalton Whatley** — Business Development Manager. The first
  call for new builder accounts.
- **Lisa Adams** — Estimator. RFQ turn 24–48 hours.
- (Optional) **Brittney Werner** — Project Manager. Pulte vendor-
  coordinator background; understands production-builder cadence.
- (Optional) **Jordyn Steider** — Delivery Logistical Supervisor.

Each card: name, title, one-line role description (≤14 words), email
or phone if appropriate for the audience.

## Layout & visual

- 3- or 4-column card grid. Each card: photo placeholder block (gradient
  Walnut→Kiln Oak with name overlay), name in serif Walnut, title in
  Kiln Oak uppercase letter-spacing 0.04em.
- HERITAGE: 3 cards max, more whitespace, photo placeholder is bigger.
- EXECUTIVE: 4 or 5 cards, tighter grid, all on one row at desktop.
- BUILDER_FIELD: skip — PMs only need a phone number, which goes in
  `terms` or `timeline` element.

## Photo placeholder

```html
<div class="team-photo-placeholder" style="
  aspect-ratio: 1/1;
  background: linear-gradient(135deg, #3E2A1E 0%, #8B6F47 100%);
  display: flex; align-items: end; padding: var(--s-3);
  color: var(--abel-cream);
  font-family: var(--font-display); font-size: var(--fs-18);
">{name}</div>
<!-- HUMAN_REVIEW: replace with team headshot from Abel-Image-Pipeline/09_library/ -->
```

## Voice / brand citations

- `memory/brand/voice.md` "Builder-to-builder" + "First-name basis."
- `CLAUDE.md` master memory — actual Abel team roster (do NOT add
  people who aren't on the list above; do NOT promote anyone to a
  title they don't hold).

## Data caveat

These names + titles + emails are from CLAUDE.md verified data. Use as-
is. Do not invent additional team members. If the user wants someone
specific included who isn't in the list above, the user will pass them
in via positioningNotes — only render extras if explicitly requested.
