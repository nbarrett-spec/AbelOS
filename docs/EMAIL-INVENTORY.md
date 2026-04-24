# Email Inventory

Snapshot of every email-sending callsite in Aegis as of the Wave-2 sprint
(Monday launch prep). Read-only reference — do not use this doc to drive
behavior. The purpose is to (a) enumerate what exists, (b) document each
trigger source, and (c) give future agents a map for consolidation.

> **Adoption of the new `src/lib/resend/` scaffold is OPTIONAL.** Existing
> callsites keep working. Migrate opportunistically when you're already
> touching a given file — do not refactor ahead of a change that needs it.

## The two sender functions today

| Sender | Path | Notes |
|---|---|---|
| `sendEmail` (legacy) | `src/lib/email.ts` | Raw fetch against `https://api.resend.com/emails`. Returns `{ success, id?, error? }`. Exports `wrap()` for the shared HTML shell. |
| `sendEmail` (new) | `src/lib/resend/client.ts` | Singleton-backed, returns `{ ok, id?, error? }`, always audit-logs under `email_send`, auto-tags `source=aegis`. Use for NEW emails. |

The `resend` npm package is **not** installed (`package.json` has no
`resend` dep). Both senders talk to the Resend REST API directly via
`fetch`. The new client is written to be a one-line swap if/when the SDK
lands.

## Callsite inventory

### A. Built-in templates in `src/lib/email.ts` (self-contained; template + send in same file)

| Function | Line | Purpose | Trigger | Template shape |
|---|---|---|---|---|
| `sendPasswordResetEmail` | 107 | Builder portal password reset | Manual (forgot-password form) | Inline HTML via `wrap()` |
| `sendInviteEmail` | 142 | Employee account invite | Manual (admin invites staff) | Inline HTML via `wrap()` |
| `sendStaffPasswordResetEmail` | 177 | Staff/ops portal password reset | Manual | Inline HTML via `wrap()` |
| `sendQuoteReadyEmail` | 209 | Quote-ready notification to builder | Workflow (on quote status → READY) | Inline HTML via `wrap()` |
| `sendOrderConfirmationEmail` | 268 | Order confirmed | Workflow (order CONFIRMED) | Inline HTML via `wrap()` |
| `sendQuoteRequestConfirmationEmail` | 328 | Quote request received | Workflow (quote request submit) | Inline HTML via `wrap()` |
| `sendInvoiceEmail` | 378 | Invoice available | Workflow (invoice ISSUED) | Inline HTML via `wrap()` |
| `sendWarrantyUpdateEmail` | 441 | Warranty claim status change | Workflow (claim UPDATE) | Inline HTML via `wrap()` |
| `sendOrderStatusEmail` | 515 | Order status change | Workflow | Inline HTML via `wrap()` |
| `sendWarrantyClaimConfirmationEmail` | 564 | Warranty claim submitted | Manual (builder submits) | Inline HTML via `wrap()` |
| `sendQuoteFollowUpDay3` | 614 | 3-day quote reminder | Cron (quote nurture) | Inline HTML via `wrap()` |
| `sendQuoteFollowUpDay7` | 667 | 7-day quote reminder | Cron | Inline HTML via `wrap()` |
| `sendQuoteExpiringEmail` | 726 | Last-chance quote reminder | Cron | Inline HTML via `wrap()` |
| `sendApplicationReceivedEmail` | 785 | Builder application ack | Manual (applicant submits) | Inline HTML via `wrap()` |
| `sendApplicationApprovedEmail` | 826 | Builder approved + credentials | Manual (admin approves) | Inline HTML via `wrap()` |

### B. Template files under `src/lib/email/`

| File | Purpose | Trigger | Notes |
|---|---|---|---|
| `src/lib/email/delivery-confirmation.ts:356` | Delivery COMPLETE confirmation to builder | Cascade (`delivery-lifecycle.ts` → COMPLETE) | Also handles photo proof strip + idempotency via `Delivery.confirmationSentAt`. Has a second send at `:381` for each CC. |
| `src/lib/email/substitution-request.ts:49` | Material substitution approval request | Workflow (substitution proposed) | Inline HTML via `wrap()` |
| `src/lib/email/substitution-approved.ts:43` | Substitution approved → notify crew | Workflow | Inline HTML via `wrap()` |
| `src/lib/email/material-arrived.ts:57` | "Your material arrived" → builder | Workflow (PO received) | Inline HTML via `wrap()` |
| `src/lib/email/material-confirm-request.ts:53` | Confirm pending material ETA | Workflow | Inline HTML via `wrap()` |
| `src/lib/email/material-escalation.ts:53` | Material issue escalation | Workflow | Inline HTML via `wrap()` |
| `src/lib/email/collections/day-15-reminder.ts:36` | 15-day friendly reminder | Cron (`/api/cron/collections-ladder`) | Inline HTML via `wrap()` |
| `src/lib/email/collections/day-30-past-due.ts:36` | 30-day past-due | Cron | Inline HTML via `wrap()` |
| `src/lib/email/collections/day-45-final.ts:36` | 45-day final notice | Cron | Inline HTML via `wrap()` |
| `src/lib/email/collections/day-60-hold.ts:36` | 60-day credit hold notice | Cron | Inline HTML via `wrap()` |

### C. Callsites that build HTML inline (no template helper)

| File:Line | Purpose | Trigger |
|---|---|---|
| `src/lib/alert-history.ts:594` | System alert email (tier A) | Internal (alert firing) |
| `src/lib/alert-history.ts:636` | System alert email (tier B) | Internal |
| `src/lib/cron-alerting.ts:213` | `[CRON FAILED]` notification to on-call | Cron wrapper (on failure) |
| `src/lib/digest-email.ts:300` | Staff daily digest | Cron (`/api/cron/daily-digest`) |
| `src/lib/agent-orchestrator.ts:749` | AI-agent outcome email | Agent workflow |
| `src/lib/cascades/po-lifecycle.ts:82` | PO sent → vendor | Cascade (PO → SENT) |
| `src/app/api/cron/weekly-report/route.ts:456` | Weekly ops report (primary) | Cron |
| `src/app/api/cron/weekly-report/route.ts:461` | Weekly ops report (extra recipients) | Cron |
| `src/app/api/cron/collections-email/route.ts:107` | Legacy collections ladder send | Cron |
| `src/app/api/cron/pm-daily-tasks/route.ts:419` | Daily PM task digest | Cron |
| `src/app/api/cron/morning-briefing/route.ts:46` | Morning briefing | Cron |
| `src/app/api/ops/invoices/[id]/remind/route.ts:104` | Manual "remind" button on an invoice | Manual (ops portal action) |
| `src/app/api/ops/purchasing/[id]/send/route.ts:95` | Manual PO send to vendor | Manual |
| `src/app/api/ops/auth/forgot-password/route.ts:76` | Ops-portal forgot password | Manual |
| `src/app/api/admin/test-alert-notify/route.ts:116` | Admin test-alert button | Manual (smoke test) |

### D. New scaffold (this sprint)

| File | Purpose | Trigger | Template shape |
|---|---|---|---|
| `src/lib/resend/client.ts` | New consolidated sender | — | `{ to, subject, html?, text?, ...}` → `{ ok, id }` or `{ ok: false, error }` |
| `src/lib/resend/templates/ar-reminder.ts` | AR reminder for Collections dashboard | Wave-3 collections UI | `renderARReminder(args) → { subject, html, text }` |
| `src/lib/resend/templates/index.ts` | Barrel export | — | Re-exports |

## Summary

| Surface | Count |
|---|---|
| Self-contained templates in `src/lib/email.ts` | 15 |
| Template files under `src/lib/email/` | 10 |
| Inline HTML callsites | 15 |
| New scaffold (AR reminder) | 1 |
| **Total sending callsites** | **~41** |

Callsites are triggered from three places:

1. **Crons** (most common) — `daily-digest`, `collections-email`, `collections-ladder`, `weekly-report`, `pm-daily-tasks`, `morning-briefing`, `cron-alerting` failures.
2. **Cascades / workflows** — delivery lifecycle, PO lifecycle, substitution and material flows.
3. **Manual** — ops-portal buttons (`remind`, `send PO`, password resets, admin test-alert).

## Recommendations

To consolidate, migrate each of these to `src/lib/resend/` scaffold over time.
The migration is voluntary and per-callsite:

1. **Low-risk first moves.** New emails (e.g. the AR reminder) use the scaffold from day one. Existing crons stay put until they need a change.
2. **Easy wins when touching a file.** If you're already editing one of the template files (e.g. `day-15-reminder.ts`) for a copy change, swap its `sendEmail` import to `@/lib/resend/client` in the same PR. Its return shape changes from `{ success }` to `{ ok }` — update the one or two callers.
3. **Keep templates pure.** The new pattern is: templates return `{ subject, html, text }` (no side effects). Senders call `sendEmail(...)` with the result. This separation makes each template trivially unit-testable and preview-renderable.
4. **Do NOT mass-rewrite.** `src/lib/email.ts` works. Breaking it the week before launch is a bad trade.

## Known gotchas

- **Two `sendEmail` exports** now exist in the repo (`@/lib/email` vs `@/lib/resend/client`). Import whichever one the rest of the file already uses; don't mix them in the same file.
- **Audit entity is `email_send`** (underscore). Matches the `entity` column convention (Wave 1 lesson).
- **`RESEND_API_KEY` missing = graceful no-op.** The new client returns `{ ok: false, error: 'RESEND_API_KEY not set' }` and audit-logs a FAIL. The legacy sender returns `{ success: false, error: 'Email service not configured …' }`. Callers should check the flag and degrade gracefully — do not throw.
- **Tag convention.** New sender auto-tags `source=aegis`; callers can add more (`{ name: 'template', value: 'ar-reminder' }`, etc.) via the `tags` arg.
- **`DEFAULT_FROM_EMAIL`** is the env var read by the new client; the legacy client reads `RESEND_FROM_EMAIL`. These coexist fine — pick one per sender.

---

> Last updated: 2026-04-23 (Wave-2 Agent B8)
