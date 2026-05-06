# Element: timeline

The "what happens next" block. Specific dates, specific people, specific
deliverables. Closes the pitch with momentum.

## Required content

Render a 3–5 step timeline from "today" through "first PO":

1. **This week** — Abel pulls samples + a tier ladder for the
   prospect's target plan(s). Lisa Adams (Estimator) returns RFQ
   within 48 hours of receipt.
2. **Week 2** — Sample drop in person at Gainesville (HERITAGE) or
   sample shipment to builder office (EXECUTIVE / BUILDER_FIELD).
   Walk-the-line if relevant.
3. **Week 3** — Pricing schedule confirmed against current builder
   spec. Any VE proposals locked.
4. **Week 4** — First PO trial. Single plan, single release.
5. **Month 2+** — Delivery cadence locked; recurring weekly or
   biweekly window per builder ops.

If `positioningNotes` says the prospect has urgency, compress this
timeline accordingly. If the prospect has a specific build start date,
back-schedule from it.

## Layout & visual

- HERITAGE: vertical timeline with narrative prose at each step.
  Generous whitespace.
- EXECUTIVE: horizontal stepper at the top of the section, with one
  card per step below. Date next to each step header in tabular nums.
- BUILDER_FIELD: tight bullet list, one line per milestone, with a
  date and an owner column.

## Date formatting

- ISO-style display dates: `Apr 30, 2026`. Use today's actual date
  (passed into the user message context).
- Always render relative milestones from today + N days. Never invent
  specific calendar dates beyond that pattern.

## Voice / brand citations

- `memory/brand/audiences.md` — "close with a one-line ask or a
  specific next step with a date."
- `memory/brand/voice.md` — "Choose. Confirm. Hang." is on-brand —
  use it once if the timeline naturally calls for a 3-step framing.

## Hard rule

The closing CTA below the timeline must be a verb + noun, not "click
here." Examples:
- "Schedule the sample drop." (HERITAGE)
- "Confirm the lead-time lock." (EXECUTIVE)
- "Send your top 3 plans for the breakdown." (BUILDER_FIELD)

CTA links: render as `<a class="btn" href="mailto:...">{verb noun}</a>`
pointing to either Nate's email or Dalton's, depending on audience
adaptation. Both are real:
`n.barrett@abellumber.com` and `d.whatley@abellumber.com` (verify
Dalton's exact email — render with HUMAN_REVIEW comment if uncertain).
