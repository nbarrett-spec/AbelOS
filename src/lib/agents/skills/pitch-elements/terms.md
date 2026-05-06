# Element: terms

Bottom-of-microsite block: contact, legal disclaimers, validity
window. The footer that protects the pitch from being misread as a
binding quote.

## Required content

Three sub-blocks:

**Contact** — Abel's main contact for this pitch.
- Name + title (Nate Barrett, Owner / GM — for big accounts; Dalton,
  Business Development Manager — for warmer mid-market accounts).
- Email + phone.
- Office address: `Abel Doors & Trim, Gainesville, TX`.

**Validity** — A short clause:
- "Pricing valid through {today + 30 days}, subject to current Boise
  Cascade and manufacturer list pricing."
- "Lead times reflect current production capacity at time of
  proposal; will reconfirm at PO acknowledgement."

**Legal** — minimal disclaimers:
- "This document is a proposal, not a binding quote. Final pricing
  and lead time confirmed at PO acceptance."
- "Abel Doors & Trim is the legal entity. 'Abel Lumber' is the trade
  name."

## Layout & visual

- Small type (`--fs-12`), Charcoal on Cream, Kiln Oak section labels.
- HERITAGE: prose footer, more space.
- EXECUTIVE: 3-column grid (contact | validity | legal).
- BUILDER_FIELD: single tight row with phone + validity + "proposal
  not quote" disclaimer in 3 columns.

## Voice / brand citations

- `memory/brand/voice.md` — "Premium without pretense" — even the
  legal block should be plain English, not legalese.
- `memory/brand/audiences.md` — banker context (`EXECUTIVE` style)
  may need a note about audited financials availability under NDA;
  builder context (`BUILDER_FIELD`, `HERITAGE`) usually doesn't.

## Hard rule

This element must include the contact block with a working email.
Without it, the pitch has no return address. If `style ===
EXECUTIVE`, default to Nate. If `HERITAGE` or `BUILDER_FIELD`,
default to Dalton.

## Data caveat

Phone number for Abel main line: render as
`[(XXX) XXX-XXXX — pending: confirm Abel main line]` with HUMAN_REVIEW.
The Quo inbox `+1 254-600-4910` is for SMS/call routing, not the
public contact line — confirm with Nate before publishing it on a
microsite.

Email addresses are real and confirmed:
- `n.barrett@abellumber.com` — Nate
- Dalton's email format follows `d.whatley@abellumber.com` pattern
  but render with HUMAN_REVIEW comment until confirmed.
