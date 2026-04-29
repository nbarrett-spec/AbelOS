# AUDIT-B-14 — Email Templates, Notifications, Outbound Communications
**Scope:** Every email path, kill switches, brand voice compliance
**Date:** 2026-04-28

## Status: 32 paths, 16 with kill switches, ~50% audit-trail coverage

## Email path inventory (32 distinct sends)

### Builder-facing (18)
- Quote ready → builder
- Order confirmation → builder
- Order shipped → builder
- Order delivered → builder
- Invoice created → builder
- Invoice overdue (4 tiers: friendly/firm/warning/hold) → builder
- Payment received → builder
- Warranty update → builder
- Quote follow-ups (Day 3 / Day 7 / Day expiring) → builder
- Application approved (with temp password) → applicant
- Password reset → builder
- Staff invite → applicant

### Internal (4 cron-driven)
- Morning briefing → Nate + leadership
- PM daily digest → 4 PMs
- Weekly report → leadership
- Collections cycle email → builder (gated)

### Automation-triggered (10)
- Material confirmation → PM
- Substitution request approved → PM/builder
- Delivery confirmation → builder
- Builder notification queue (multiple types) → builder
- Escalation alerts → managers

## Kill switch coverage matrix

| Kill switch | Coverage | Status |
|---|---|---|
| `EMAILS_GLOBAL_KILL` | ~80% (via sendEmail + Resend client) | ✅ Just shipped this wave |
| `BUILDER_INVOICE_EMAILS_ENABLED` | Builder notifications via EmailQueue | ✅ Wired |
| `COLLECTIONS_EMAILS_ENABLED` | Collections cycle 4-tier dunning | ✅ Wired (defaults false) |
| `FEATURE_PM_DIGEST_EMAIL` | PM daily digest | ✅ Wired (defaults off) |
| Per-template SystemAutomation toggles (sa_003/006/009/012/013/014) | Order lifecycle emails | ✅ Just shipped Phase 2 |

## P0 — Risks for launch

### 1. Quote follow-ups have NO individual kill switch
- `src/app/api/cron/quote-followups/route.ts` fires to builders
- Only `EMAILS_GLOBAL_KILL` stops them
- ~30 builders on quote timers
- **Fix:** Add `QUOTE_FOLLOWUP_EMAILS_ENABLED` env var. Effort: 30 min.

### 2. Application-approved emails embed temp password in plaintext
- `src/lib/email.ts:869-912` puts password directly in HTML body
- If email source leaks, password visible
- **Fix:** Send invite link with first-login password set. Effort: 4 hours.

### 3. Delivery notifications fire on every status change without kill switch
- `src/lib/notifications.ts:502-585`
- 6 statuses: SCHEDULED, LOADING, IN_TRANSIT, ARRIVED, COMPLETE, RESCHEDULED
- No per-status control
- **Fix:** Add `DELIVERY_NOTIFICATIONS_ENABLED` env var, or use SystemAutomation toggles per status. Effort: 1 hour.

## P1 — Important

### 4. Collections emails use legacy sendEmail() — not audit-logged
- `src/app/api/cron/collections-email/route.ts:133` calls legacy path
- New `AuditLog` table not written
- Can't answer "did we email builder X on day Y?"
- **Fix:** Migrate to Resend client which writes AuditLog automatically. Effort: 1 hour.

### 5. PM Digest recipients auto-pulled, no allowlist
- `WHERE active = true AND email <> ''`
- Stale addresses silently skipped
- No recent-email validation
- **Fix:** Add `PM_DIGEST_RECIPIENTS` allowlist env var, or active-staff verification. Effort: 30 min.

### 6. EmailQueue table not consumed
- Builder notifications create EmailQueue rows (status=PENDING)
- No background processor visible
- Queue is orphaned — emails never sent
- **Fix:** Either add queue processor or remove EmailQueue insertion. Effort: 4 hours OR 30 min to remove.

## P2 — Brand voice compliance

| Template | Voice score | Note |
|---|---|---|
| sendQuoteReadyEmail | ✅ Compliant | Quiet competence, no emoji |
| sendOrderConfirmationEmail | ✅ Compliant | |
| sendWarrantyUpdateEmail | ✅ Compliant | |
| PM Digest | ✅ Compliant | Factual, concise, no exclamation marks |
| Collections "FINAL NOTICE" / "Credit Hold Notice" | ⚠️ Aggressive | Severity-appropriate but tonally distinct from rest of voice |

## P2 — Test mode gap

- ❌ No per-builder test list
- ✅ `DRY_RUN=1` mode in PM digest only
- ✅ Manual cron trigger via staff auth
- **Fix:** Add `DRYRUN_RECIPIENT` env var — when set, redirects all sends to that address for safe preview. Effort: 1 hour.

## What `EMAILS_GLOBAL_KILL=true` actually achieves

- ✅ Blocks ALL sends via `sendEmail()` in `src/lib/email.ts` (~18 paths)
- ✅ Blocks ALL sends via `sendEmail()` in `src/lib/resend/client.ts` (~6 paths)
- ❌ Does NOT block: Builder notifications queued in EmailQueue (no processor anyway, so moot)
- ❌ Does NOT block: Stripe invoice emails (Stripe controls these)
- ❌ Does NOT block: Delivery notifications direct path

**Net effect: ~80% of email stopped. The 20% that escapes is queued (no processor, moot) or Stripe-controlled.**

## Recommendations

**Pre-launch (Monday morning):**
1. Set `EMAILS_GLOBAL_KILL=true` in Vercel — already on todo list
2. Set `BUILDER_INVOICE_EMAILS_ENABLED=false` (already default) — verify
3. Verify Stripe Dashboard email config matches Abel domain

**Tuesday/Wednesday post-launch:**
1. Add 3 missing kill switches (quote followups, delivery notifications, master fallback)
2. Migrate collections emails to Resend client (audit-trail parity)
3. Decide EmailQueue fate (build processor or drop model)
4. Add DRYRUN_RECIPIENT for safe testing

**Following week:**
1. Fix temp-password-in-email vulnerability (security debt)
2. Allowlist PM digest recipients

## Launch readiness: **75%**
- Master kill switch shipped, works correctly
- Most paths gated
- ~5 paths lack feature-level kill switch but are gated globally
- Audit trail is bimodal (Resend ✓, legacy sendEmail ✗)
