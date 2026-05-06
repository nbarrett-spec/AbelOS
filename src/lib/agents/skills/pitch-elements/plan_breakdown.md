# Element: plan_breakdown

Per-plan unit-cost decomposition. The "Brookfield Rev2" pattern — open
a spreadsheet view inside the microsite. This is the section that
gets forwarded to the construction manager.

Skip this element entirely if `targetPlans` is empty or has fewer than
2 plans. Only renders when there's actually plan data to break down.

## Required content

For each plan in `targetPlans`, a card or table block with:

- Plan name + sqFt (header)
- Door count (interior + exterior split if known)
- Trim LF total (if known)
- Hardware count (locks + hinges + stops)
- Per-component cost lines (Doors, Trim, Hardware, Install kit) —
  each as a placeholder with `<!-- HUMAN_REVIEW -->` if not user-
  supplied
- Plan-level subtotal
- Compare-to-current row (if `currentVendor` known): "vs. {currentVendor}
  current spec: {Δ}"

## Layout & visual

- BUILDER_FIELD: full table, all plans, one big sortable-looking grid.
  Sticky header. Right-aligned dollar columns. Show Δ in Walnut for
  savings, Oxblood for upcharges.
- EXECUTIVE: one Chart.js stacked bar chart showing Doors / Trim /
  Hardware composition per plan, then a tighter table of the top-3
  plans by volume.
- HERITAGE: skip — not a fit for the audience.

## Chart.js spec (when used)

```js
{
  type: 'bar',
  data: {
    labels: [planNames],
    datasets: [
      { label: 'Doors',    data: [...], backgroundColor: '#3E2A1E' },
      { label: 'Trim',     data: [...], backgroundColor: '#8B6F47' },
      { label: 'Hardware', data: [...], backgroundColor: '#C9822B' },
    ],
  },
  options: {
    indexAxis: 'y',
    scales: { x: { stacked: true, title: { display: true, text: 'Material cost ($/home)' } },
              y: { stacked: true } },
    plugins: { legend: { position: 'bottom' } },
  },
}
```

## Voice / brand citations

- `memory/brand/audiences.md` "Production builders" — they want plan-
  level deltas in dollars.
- `memory/brand/html-build-defaults.md` Chart.js defaults block.

## Data caveat

If composition split (door $ vs trim $ vs hardware $) is not given,
either (a) skip this element entirely, or (b) emit only the
plan-level totals from `materialBudget` without splitting. Don't
fabricate a 60/30/10 split or similar.
