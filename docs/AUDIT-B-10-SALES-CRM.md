# AUDIT-B-10 — Sales / Quote / CRM Pipeline
**Scope:** End-to-end Lead → Deal → Quote → Order pipeline
**Date:** 2026-04-28

## Status: 70% complete — functional core, gaps in pricing engine + automation

## What works ✅

- **Deal pipeline:** All 9 stages (PROSPECT → ONBOARDED) exist; stage transitions guarded; deal ownership tracked. Dalton can see his book via `/api/ops/sales/deals` with filtering.
- **Quote conversion analytics:** `/api/ops/quotes/conversion` shows quote-to-order rates, recovery opportunities, trends by builder/category.
- **Takeoff → Quote flow:** Fully wired. `/api/ops/takeoffs/[id]/generate-quote` spins draft quotes from takeoff items; Lisa can edit lines before sending.
- **Sales reports:** Win/loss, pipeline by stage, cycle time, by-rep performance via `/api/ops/sales/reports`.
- **Outreach engine:** Multi-step automated sequences (email/SMS/call tasks) with semi-auto approval; 9 contracted accounts can be enrolled in drip campaigns.

## P0 — Launch blockers

### 1. Quote → Order auto-conversion missing
- Manual endpoint `/api/quotes/[id]/convert` exists but requires explicit builder action
- No server-side automation triggers APPROVED quotes → orders
- Sales rep can't auto-generate orders from ops side
- **Fix:** Add "Convert to Order" button in quote detail page calling existing POST endpoint; auto-advance deal stage to WON. Effort: 2 hours.

## P1 — Important gaps

### 2. Brookfield Rev 4 plan-level pricing NOT implemented
- Schema has `ContractPricingTier` and `PricingTierRule` tables
- BUT no plan-level logic in quote generation or pricing engine
- Brookfield's dynamic pricing per floor plan (20 plans) absent
- Lisa can't apply per-plan tiers — must edit each line manually
- **Fix:** Add `planPricingTier` lookup in quote generation; if contract has tier for plan X, apply multiplier. Effort: 4 hours.

### 3. Bloomfield tiered-markup pricing incomplete
- BuilderPricing supports custom per-product pricing
- BUT no tiered markup multiplier system for volume/category-based discounts (20%/26%/35%)
- **Fix:** Extend pricing engine with category-tiered multiplier. Defer to P2 if needed.

## P2 — Quality of life

### 4. No stale lead / no-touch alerts
- DealActivity log exists
- BUT no automated stale-deal detection
- Dalton can't see leads untouched 30+ days
- **Fix:** Background job or batch report flagging DISCOVERY/BID_SUBMITTED deals >30 days. Effort: 2 hours.

### 5. Quote email send / approval workflow undefined
- Quote.approvedAt column exists
- BUT no email/PDF generation, no approval link, no callback webhook
- Quotes must be manually sent by staff
- **Fix:** Generate shareable approval links + send PDF email + detect approval webhook. Effort: 6 hours, post-launch acceptable.

## Recommendations

**For Monday launch (in order):**
1. Wire "Convert to Order" button on quote detail (P0, 2 hr)
2. Stub Brookfield plan-level pricing — even minimal multiplier helps Lisa (P1, 4 hr)
3. Add stale-lead detection report (P2, 2 hr)

**Defer to post-launch:**
- Quote send UI + approval link
- Bloomfield tiered markup (small customer impact)
- Full pricing engine refactor

## Launch readiness: **70%**
- Deals + quotes flow manually
- Pricing engine incomplete for contracted tiers
- Estimator (Lisa) workflow has friction on Brookfield
