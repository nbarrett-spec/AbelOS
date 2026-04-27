# SCAN-A9 — Email Send-Path Gate Audit

**HEAD:** 171a6b4 · **Mode:** READ-ONLY · **Date:** 2026-04-27

Goal: enumerate every code path that sends outbound email from the Aegis
codebase, identify the gate (env flag, feature flag, role check) that
controls it, and flag anything builder/vendor-facing that could fire
accidentally on launch day.

---

## Summary

| Audience | Total paths | Gated | Ungated |
|---|---|---|---|
| Builder-facing | 21 | 9 | 12 |
| Staff/PM-facing | 9 | 1 | 8 |
| Vendor-facing | 1 | 0 | 1 |
| System/monitoring | 6 | 1 | 5 |

**Headline P0:** twelve builder-facing send paths have no kill switch. The
COLLECTIONS_EMAILS_ENABLED + BUILDER_INVOICE_EMAILS_ENABLED gates land the
two most damaging categories (Day-15/30/45/60 ladder, invoice issued/remind),
but quote-ready, order-confirmation, quote-followups, delivery-confirmation,
delivery-status changes, warranty updates, application-received, and
application-approved all dispatch unconditionally as soon as RESEND_API_KEY
is present.

**Resend config:** `RESEND_API_KEY` is the only "switch." When unset every
path returns `{ success: false }` and logs `email_service_not_configured`.
There is no env-level "test mode" — the gate is binary: key present → live
sends, key absent → silent no-op. Setting `DRY_RUN=1` only short-circuits
the new `/api/ops/collections/send-reminder` and `/api/cron/daily-digest`
endpoints; the older `src/lib/email.ts::sendEmail()` ignores it.

---

## Builder-facing paths

| # | Path | File | Trigger | Gate | Default | Risk |
|---|---|---|---|---|---|---|
| 1 | Day-15 reminder | `src/app/api/cron/collections-ladder/route.ts` (cron 13:00 UTC daily) | scheduled cron | `COLLECTIONS_EMAILS_ENABLED==='true'` (line 454) | OFF | low |
| 2 | Day-30 past-due | same cron | scheduled | same gate | OFF | low |
| 3 | Day-45 final | same cron | scheduled | same gate | OFF | low |
| 4 | Day-60 hold (+ Nate cc copy) | same cron, lines 363/390 | scheduled | same gate | OFF | low |
| 5 | Day-15/30/45/60 manual send | `src/app/api/ops/collections/[invoiceId]/action/route.ts` line 196 | staff click in Collections cockpit | same gate | OFF | low |
| 6 | Tier-based collections email | `src/app/api/cron/collections-email/route.ts` (cron 14:00 UTC weekdays) | scheduled | same gate (line 38) | OFF | low |
| 7 | Invoice reminder (legacy) | `src/app/api/ops/invoice-reminder/route.ts` line 22 | staff click | same gate | OFF | low |
| 8 | Single-builder AR reminder | `src/app/api/ops/collections/send-reminder/route.ts` | staff click on Collections cockpit | `FEATURE_COLLECTIONS_SEND_REMINDER!=='off'` AND `RESEND_API_KEY` set (lines 64, 177) | **ON** (default-on, only `'off'` disables) | **med** — flag default ON; one click sends to builder. Dry-run if `DRY_RUN=1` |
| 9 | Per-invoice payment reminder | `src/app/api/ops/invoices/[id]/remind/route.ts` line 17 | staff click | `BUILDER_INVOICE_EMAILS_ENABLED==='true'` | OFF | low |
| 10 | Invoice ISSUED/SENT auto-notify | `src/app/api/ops/invoices/[id]/route.ts` line 181 | status change PATCH | same gate | OFF | low |
| 11 | Quote-ready (cart create) | `src/app/api/quotes/route.ts` line 150 | builder accepts cart | none | ON | **P0** — builder-facing, fires on cart submit |
| 12 | Quote-ready (takeoff create) | `src/app/api/quotes/route.ts` line 361 | takeoff→quote | none | ON | **P0** — same as above |
| 13 | Quote-ready (status→SENT) | `src/app/api/ops/quotes/route.ts` line 567 | staff PATCHes status to SENT | none | ON | **P0** — staff click, builder gets email |
| 14 | Quote follow-up Day 3 / 7 / Expiring | `src/app/api/cron/quote-followups/route.ts` (cron 09:00 weekdays, lines 116/133/153) | scheduled | none | ON | **P0** — fires on every Quote in SENT state at 3d/7d/expiry |
| 15 | Order confirmation (builder approves quote) | `src/app/api/quotes/[id]/route.ts` line 225 | builder click "approve" | none | ON | **P0** |
| 16 | Order confirmation (builder POSTs order) | `src/app/api/orders/route.ts` line 192 + `notifyOrderConfirmed` line 209 | builder action | none on `sendOrderConfirmationEmail`; `notifyOrderConfirmed` is gated by `BUILDER_INVOICE_EMAILS_ENABLED` for queueing only | ON for direct send | **P0** |
| 17 | Order status change (CONFIRMED/SHIPPED/DELIVERED via notify*) | `src/app/api/ops/orders/[id]/route.ts` lines 211–215 | staff status change | gated by `BUILDER_INVOICE_EMAILS_ENABLED` (notifications.ts line 118) — but the *in-app* notification still fires | OFF for email | low (gated) |
| 18 | Stripe payment received → `notifyPaymentReceived` | `src/lib/webhooks/stripe-processor.ts` line 113 | Stripe webhook | `BUILDER_INVOICE_EMAILS_ENABLED` (notifications.ts) | OFF | low |
| 19 | Delivery status change (SCHEDULED/LOADING/IN_TRANSIT/ARRIVED/COMPLETE/RESCHEDULED) | `src/app/api/crew/delivery/[id]/route.ts` line 250, `src/app/api/ops/delivery-notify/route.ts` line 36 → `notifyDeliveryStatusChange` | driver PWA / staff click | `BUILDER_INVOICE_EMAILS_ENABLED` (queue side only) | OFF | low |
| 20 | Delivery confirmation w/ photos | `src/lib/cascades/delivery-lifecycle.ts` line 136 → `sendDeliveryConfirmation`; also POST `/api/ops/deliveries/[id]/send-confirmation` | auto-fires on first COMPLETE; manual resend | **none** — bypasses notification queue and calls `sendEmail` directly | ON | **P0** — builder-facing photo email auto-fires on every delivery completion. Idempotency (`confirmationSentAt` column) prevents duplicates but does NOT gate the first send |
| 21 | Warranty status update | `src/app/api/ops/warranty/claims/[id]/route.ts` line 200 | staff status PATCH | none | ON | **P0** — fires on every warranty status edit |
| 22 | Warranty claim filed (confirmation) | `src/app/api/builders/warranty/route.ts` line 101 | builder submits claim | none | ON | **P1** — builder-initiated, low surprise but no kill switch |
| 23 | Quote-request received (confirmation) | `src/app/api/builders/quote-request/route.ts` line 176 | builder submits request | none | ON | **P1** — builder-initiated |
| 24 | Application received | `src/app/api/builders/register/route.ts` line 154 | public registration form | none | ON | **P1** — public-form-initiated |
| 25 | Application approved (with temp password) | `src/app/api/ops/builders/applications/route.ts` line 172 | staff approves application | none | ON | **P1** — sends temp password to builder; staff-initiated |
| 26 | Builder password reset | `src/app/api/auth/forgot-password/route.ts` line 61 | builder clicks "forgot" | none (rate-limited 10 / window via `authLimiter`) | ON | low — user-initiated |
| 27 | Agent-orchestrator quote/welcome/reorder | `src/lib/agent-orchestrator.ts` line 749 | manual / agent kick | none | ON | **P1** — labeled "WELCOME / REORDER_OPPORTUNITY / quote ready" — sends to `quoteRecord.email`. If the orchestrator runs against any prod builder, that's outbound mail with no gate |

> Count: 21 unique builder-recipient paths (collapsed Day-15/30/45/60 cron variants, but separated cron vs manual; the table shows 27 numbered rows because of variant entry points).

## Staff / PM-facing paths

| # | Path | File | Trigger | Gate | Default | Risk |
|---|---|---|---|---|---|---|
| 1 | PM material-confirm-request (T-7) | `src/app/api/cron/material-confirm-checkpoint/route.ts` line 180 | daily 13:00 UTC cron | none | ON | medium — staff PMs only, but no kill switch. Fires per AMBER/RED job |
| 2 | PM material-arrived (GREEN flip) | `src/app/api/ops/receiving/[id]/receive/route.ts` line 413 | staff receives PO | none | ON | low — staff PM only |
| 3 | Material escalation (Clint + Nate) | `src/app/api/cron/material-confirm-checkpoint/route.ts` line 311 (auto T-3) and `src/app/api/ops/jobs/[id]/material-escalate/route.ts` line 180/196 (PM action) | cron + manual | none | ON | low — internal only |
| 4 | Substitution-request (PM + Clint cc) | `src/app/api/ops/products/[productId]/substitutes/apply/route.ts` line 189 | staff applies CONDITIONAL sub | none | ON | low — internal only |
| 5 | Substitution decision (approve / reject) | `src/app/api/ops/substitutions/requests/[id]/{approve,reject}/route.ts` lines 137 / 112 | staff click | none | ON | low — internal only |
| 6 | PM Daily Digest (7 AM CT) | `src/app/api/cron/pm-daily-digest/route.ts` line 304 | cron 12:00 UTC weekdays Mon–Sat | `FEATURE_PM_DIGEST_EMAIL==='true'` (line 153) | OFF | **clean** — only gated cron in this group |
| 7 | PM daily tasks email | `src/app/api/cron/pm-daily-tasks/route.ts` line 419 | cron 11:30 UTC weekdays | none | ON | medium — duplicate of #6 with no kill switch; iterates every active PM |
| 8 | Daily-digest (every active staff) | `src/app/api/cron/daily-digest/route.ts` (cron 11:00 UTC daily) → `src/lib/digest-email.ts::sendDigest` line 300 | scheduled | gated by `RESEND_API_KEY` presence + per-staff `digestOptOut` + idempotent EmailSendLog | ON-when-key | medium — every active staff member, daily |
| 9 | Staff invite / staff password reset | `src/app/api/ops/staff/route.ts`, `bulk-invite/route.ts`, `[id]/route.ts` (resend-invite, reset-password) and `src/app/api/ops/auth/forgot-password/route.ts` | staff admin click | none beyond rate limiter | ON | low — admin-initiated |

## Vendor-facing paths

| # | Path | File | Trigger | Gate | Default | Risk |
|---|---|---|---|---|---|---|
| 1 | PO send to vendor | `src/app/api/ops/purchasing/[id]/send/route.ts` line 95 + cascade `src/lib/cascades/po-lifecycle.ts` line 82 | staff click "Send PO" / cascade on PO status | none | ON | **P1** — vendor-facing send with no kill switch. Cascade can fire from PO lifecycle transitions automatically |

## System / monitoring paths

| # | Path | File | Trigger | Gate | Default | Risk |
|---|---|---|---|---|---|---|
| 1 | Cron failure alert (Nate + Clint) | `src/lib/cron-alerting.ts` line 213 | every cron FAILURE via `finishCronRun` | rate-limited 1/hour per cron | ON | low — internal |
| 2 | Critical alert incident notify | `src/lib/alert-history.ts` line 594 | when AlertIncident hits CRITICAL severity | `ALERT_NOTIFY_EMAILS` env (silent if unset) | ON-when-set | low |
| 3 | Critical alert escalation | `src/lib/alert-history.ts` line 636 | stuck-open incident | same | ON-when-set | low |
| 4 | Smoke test endpoint | `src/app/api/admin/test-alert-notify/route.ts` line 116 | staff POST | staff auth + `ALERT_NOTIFY_EMAILS` set | ON-when-set | low — `[TEST]` subject |
| 5 | Morning briefing → Nate + Clint | `src/app/api/cron/morning-briefing/route.ts` line 46 (12:00 UTC weekdays) | cron | none | ON | low — internal |
| 6 | Weekly ops report → Nate + Clint | `src/app/api/cron/weekly-report/route.ts` lines 456/461 (Mon 13:00 UTC) | cron | none | ON | low — internal |

---

## Findings (severity-ordered)

### P0 — builder-facing, no kill switch

1. **Quote-ready emails** (`sendQuoteReadyEmail`) — three call sites:
   `src/app/api/quotes/route.ts` (cart create + takeoff create) and
   `src/app/api/ops/quotes/route.ts` (status → SENT). Any successful quote
   creation against a builder with an email triggers a Resend call. No env flag.
2. **Quote follow-up cron** (`src/app/api/cron/quote-followups/route.ts`,
   `0 9 * * 1-5`) — Day 3 / Day 7 / Day-before-expiry follow-ups iterate
   *every* `Quote` in SENT status. No kill switch; idempotency relies on
   `checkFollowupActivity` audit lookup. If seed data has any SENT quotes
   from old prod, builders get follow-ups on first cron tick.
3. **Order-confirmation emails** (`sendOrderConfirmationEmail`) — fires on
   builder POST `/api/orders` (line 192) and on quote-approve at
   `src/app/api/quotes/[id]/route.ts:225`. `notifyOrderConfirmed` (the
   in-app variant) is gated by `BUILDER_INVOICE_EMAILS_ENABLED`, but the
   raw `sendOrderConfirmationEmail` path is NOT.
4. **Delivery confirmation** (`sendDeliveryConfirmation`) — auto-fires from
   the `onDeliveryComplete` cascade in `src/lib/cascades/delivery-lifecycle.ts`
   the moment any delivery flips to COMPLETE. Photos + signature inlined.
   Idempotency stamp prevents duplicates but does NOT prevent the first
   send. Any backfill of old completed deliveries through that cascade
   would email every builder on file.
5. **Warranty update** (`sendWarrantyUpdateEmail`) — `src/app/api/ops/warranty/claims/[id]/route.ts:200` fires on every status change.
6. **Material-confirm-request cron** (`material-confirm-checkpoint`,
   `0 13 * * *`) emails PMs daily — staff-facing, but a misconfigured
   `pmEmail` field that points to a builder address would leak. No
   sender-side allowlist on the recipient.
7. **Single-builder AR reminder** (`/api/ops/collections/send-reminder`)
   — `FEATURE_COLLECTIONS_SEND_REMINDER` defaults ON (only `'off'`
   disables). One click → email. The newer collections cockpit ergonomics
   button bypasses the `COLLECTIONS_EMAILS_ENABLED` gate that hardens the
   ladder cron. Inconsistent with the rest of collections.
8. **Agent-orchestrator outreach** (`src/lib/agent-orchestrator.ts:749`)
   — sends quote/welcome/reorder emails. No env flag; fires when
   `executeQuoteAction` is invoked from the workflow engine. Should be
   gated until launch.

### P1 — vendor-facing or staff-facing, no kill switch

9. **PO-send to vendor** (`/api/ops/purchasing/[id]/send` + cascade
   `po-lifecycle.ts:82`). Cascade can fire automatically from a PO
   status transition — accidental status edit could mail Boise Cascade
   a stale PO.
10. **Application received** (public registration), **application approved**
    (sends temp password), **warranty claim filed**, **quote-request
    received** — all four are user-initiated, but launch-day data backfills
    or test scripts could trigger them in bulk.
11. **PM daily-tasks cron** (`/api/cron/pm-daily-tasks`, `30 11 * * 1-5`)
    iterates every active PM with no kill switch. The newer `pm-daily-digest`
    cron is gated by `FEATURE_PM_DIGEST_EMAIL`; the older `pm-daily-tasks`
    cron is not. Two PM digest emails will go out on launch day if both
    crons run.

### P2 — clean / documented

12. Collections ladder & manual collections action — fully gated by
    `COLLECTIONS_EMAILS_ENABLED`. Five paths, all gated.
13. Builder invoice notifications — gated by
    `BUILDER_INVOICE_EMAILS_ENABLED`. Three queue paths
    (`notifyInvoiceCreated`, `notifyOrderConfirmed`, `notifyDeliveryStatusChange`,
    `notifyPaymentReceived`, `notifyWarrantyUpdate`, etc.) all gate the
    `EmailQueue` insert. The in-app `BuilderNotification` row still writes,
    only outbound email is suppressed.
14. PM Daily Digest cron — gated by `FEATURE_PM_DIGEST_EMAIL`.
15. Daily-digest cron — soft-gated by `RESEND_API_KEY` presence + per-staff
    `digestOptOut` preference + EmailSendLog idempotency.
16. Cron alerts — internal only, rate-limited.

### Other observations

- **EmailQueue inserts have no worker.** `sendBuilderNotification` writes
  rows into `EmailQueue` (when `BUILDER_INVOICE_EMAILS_ENABLED=true`), but
  there is no cron or process that drains those rows and calls Resend.
  Search for `EmailQueue.*PENDING.*sendEmail` returns no matches. So today,
  even with the gate flipped on, those queued rows just accumulate. This
  is a soft-lock that may be intentional (in-app notifications still work,
  email is parked); confirm with Nate before flipping the env flag.
- **Recipient list of `morning-briefing` is hard-coded** to
  `n.barrett@abellumber.com,clint@abellumber.com` (single string, comma-
  separated). Resend will treat that as one literal recipient and fail
  delivery. Worth fixing before launch but low blast-radius.
- **Resend `from` defaults differ across modules.** `src/lib/email.ts`
  uses `RESEND_FROM_EMAIL` (default `Abel Lumber <noreply@abellumber.com>`),
  `src/lib/resend/client.ts` uses `DEFAULT_FROM_EMAIL` (default
  `noreply@abellumber.com` — no display name). Any path that goes through
  the new client will send with the bare address. Prefer single env var.

---

## Recommended hardening (priority order)

1. **Add a master `EMAILS_GLOBAL_KILL=true` env flag** read at the top of
   `src/lib/email.ts::sendEmail()` and `src/lib/resend/client.ts::sendEmail()`.
   Returns `{ success: false, error: 'globally_disabled' }` immediately.
   That single flag covers every path on this report — call it the
   launch-day insurance policy. Default OFF after launch.
2. **Add an audience-scoped flag** for the P0 cluster
   (`BUILDER_TXN_EMAILS_ENABLED` or similar) that hard-gates: quote-ready,
   quote-followups, order-confirmation, delivery-confirmation, warranty
   updates, application-received/approved, warranty-claim-confirmation,
   quote-request-confirmation. Default OFF for launch; flip ON once Nate
   has tested each surface end-to-end with a real builder address.
3. **Flip `FEATURE_COLLECTIONS_SEND_REMINDER` default to OFF.** Inconsistent
   with the rest of the collections suite. Either make it `=== 'on'` to
   enable, or fold it under `COLLECTIONS_EMAILS_ENABLED`.
4. **Add `VENDOR_EMAILS_ENABLED` gate** for `po-lifecycle.ts:82` and
   `/api/ops/purchasing/[id]/send`. Boise / DW / Masonite shouldn't get
   surprise PO mail on launch day.
5. **Decommission the old `pm-daily-tasks` cron** or gate it under the same
   `FEATURE_PM_DIGEST_EMAIL` flag as `pm-daily-digest`. Currently both
   would fire on launch day for every active PM.
6. **Document `EmailQueue` parking** — note in `notifications.ts` that
   inserts there are not drained anywhere. If the intent is "queue for
   later replay," wire a worker; if not, drop the table writes when the
   gate is OFF and don't insert in the first place.
7. **Audit `agent-orchestrator.ts:749`** — gate behind a per-action env
   flag (`FEATURE_AGENT_OUTBOUND_EMAIL`) and require it default OFF until
   the orchestrator ships.
8. **Add a runtime allowlist** during the first 7 days post-launch:
   if `EMAIL_RECIPIENT_ALLOWLIST` is set, drop any `to` not in the list
   (with a logger.warn). Cheapest backstop against accidental builder
   blast-out from cron edge cases.
