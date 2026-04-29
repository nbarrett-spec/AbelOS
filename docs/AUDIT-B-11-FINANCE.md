# AUDIT-B-11 — Finance / AR / AP / Collections / Cash
**Scope:** End-to-end finance workflow for Dawn (Accounting Manager)
**Date:** 2026-04-28

## Status: Trust-blocker — multiple data drift issues compromise AR/AP totals

## P0 — Launch-day blockers

### 1. 3,198 DELIVERED orders without invoices ($6.2M revenue gap)
- Root cause: No auto-invoice trigger on Order.status='DELIVERED'
- Current: `POST /api/ops/invoices/from-order` requires manual call
- Impact: AR aging shows $6.2M undercount; FinancialSnapshot revenue understated
- **Fix:** Add async trigger in `src/lib/cascades/order-lifecycle.ts` (Phase 2 cascades already do this for new orders — needs backfill for the 3,198 historic). Effort: 2 hours + 30 min backfill script.

### 2. 585 negative invoices misclassified as PAID
- Root cause: Credit invoices (negative Invoice.total) are status='PAID' instead of VOID/WRITE_OFF
- Impact: Overdue AR% inflated; current ratio calculation misleading
- **Fix:** Validation in invoice update API to set status='VOID' for total ≤ 0; backfill historic rows. Effort: 1 hour.

### 3. Order.total stale on 91% of rows ($1.7M drift)
- Root cause: Order.total is denormalized sum of OrderItem.lineTotal; no refresh trigger on OrderItem INSERT/UPDATE
- Impact: Invoice amounts may diverge from order items
- **Fix:** Already-shipped W1-ORDER-TOTAL cron recomputes every 4h. Backfill script `scripts/_recompute-order-totals.mjs` exists — verify if it's been run on prod. Effort: run script (30 min).

### 4. Collections emails disabled (`COLLECTIONS_EMAILS_ENABLED=false`)
- Cron creates CollectionAction rows but no emails sent
- Dunning ladder not active; overdue invoices not escalated
- **Fix:** Set env var to true post-launch when ready; verify builder notification template; smoke test. Effort: 30 min.

### 5. financial-snapshot cron 6 consecutive failures
- One-character fix already shipped this session (`$20::jsonb` cast)
- **Verify:** is fix live on prod yet? Check Vercel deployment includes commit `ec1a7f6`.

## P1 — Important

### 6. QuickBooks integration not live (Phase 2 stub)
- Decision: QBO over QBWC (made 2026-04-22)
- All sync methods return `{ skipped: true, reason: 'not implemented yet' }`
- No GL posting; manual reconciliation required
- **Fix for launch:** Disable QB sync UX or gate behind feature flag; document manual export workflow; schedule QBO OAuth + sync for Phase 2. Effort: 1 hr to gate; ~2 weeks for full implementation.

### 7. Stripe payment links not wired into invoice flow
- Stripe keys configured (Nate did this earlier in session)
- BUT `Invoice.stripeSessionId/stripeCustomerId/stripePaymentUrl` are dead schema columns
- Builders can't pay online — Stripe is a one-way webhook sink only
- **Fix:** Wire payment-link generation into invoice create flow. Effort: 4 hours.

### 8. Schema drift: POCategory enum in schema but not in DB
- 14 phantom fields, 160 missing columns, 1 enum mismatch documented in `prisma/RECONCILE_DRIFT_2026_04_22.md`
- **Fix:** W2 schema-sync agent (already on todo list, deferred). Effort: 1 day.

## P2 — Quality of life

- AR aging dashboard exists but doesn't flag the misclassified credits visually
- No "Recompute / Repair" UI for Dawn to trigger backfills
- Lien releases workflow complete but no builder-facing visibility
- Cash flow forecasting crons exist but no UI dashboard (sketched in `cash-flow-optimizer/`)

## What works ✅

- Invoice lifecycle DRAFT → ISSUED → SENT → PAID implemented
- Payment recording API works
- Lien releases workflow complete
- Collections cycle infrastructure (cron + ladder) correct, just disabled
- AR aging query correct

## Recommendations

**Highest leverage fix (3 hours combined):**
1. Backfill 3,198 historic DELIVERED orders → DRAFT invoices
2. Recategorize 585 negative invoices → VOID
3. Run Order.total recompute script

**Then enable in this order:**
4. Set `COLLECTIONS_EMAILS_ENABLED=true` (after Nate verifies template) (30 min)
5. Wire Stripe payment-link generation into invoice flow (4 hr)
6. Gate or disable QB sync UX for launch (1 hr)

## Dawn's launch-day blocker

**Dawn cannot confidently report AR/AP position to leadership until items 1-3 above are fixed.** $6.2M revenue gap + $1.7M order drift + 585 misclassified credits = headline numbers all wrong.

## Launch readiness: **45%**
- Pages exist and are functional
- Underlying data is wrong
- Trust in numbers must be restored before Dawn can use platform daily
