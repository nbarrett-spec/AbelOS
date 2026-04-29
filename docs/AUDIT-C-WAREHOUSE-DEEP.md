# AUDIT-C — Warehouse Deep Dive
**Date:** 2026-04-28
**Scope:** /ops/warehouse, /ops/portal/warehouse, /ops/receiving, all related APIs

## Risk-tier summary
- HIGH: 5 items (W-1 to W-5)
- MEDIUM: 8 items (W-6 to W-13)
- LOW: 5 items (W-14 to W-18)

## HIGH-risk gaps

### W-1 — Inbound truck check-in & dock assignment
- Persona: Receiving coordinator, warehouse lead
- Current: Cross-dock logic exists in `/api/ops/warehouse/cross-dock` but no truck-to-bay binding
- Fix: Add TruckCheckIn table; modal in `/ops/receiving/page.tsx`
- Effort: 4-8hr
- Deps: none

### W-2 — Damage/condition photo capture during receipt
- Persona: Receiving, warehouse tech
- Current: Receiving condition selector is text-only (OK/DAMAGED/SHORT)
- Fix: Add DamagePhoto table + Cloudinary uploader in receiving form
- Effort: 4-8hr
- Deps: none

### W-3 — Receiving discrepancy reconciliation UI
- Persona: Receiving, vendor manager
- Current: System flags condition but no workflow to log discrepancy root cause / resolve backorder
- Fix: ReceivingDiscrepancy table + reason codes + vendor notification trigger
- Effort: 1day+
- Deps: none

### W-4 — NFC tag lifecycle & put-away routing
- Persona: Warehouse tech, lead
- Current: Bay map shows NFC tag IDs; no lifecycle transitions modeled (PRODUCTION → QC_PASSED → STORED → STAGED → DELIVERED)
- Fix: DoorBayAssignment table + put-away router POST /api/ops/warehouse/put-away
- Effort: 1day+
- Deps: W-1, W-2

### W-5 — Material substitution visibility in receiving
- Persona: Warehouse tech, receiving
- Current: Substitution logic in schema but warehouse portal has zero visibility
- Fix: Substitution lookup in receiving API; UI banner showing pre-approved subs
- Effort: 4-8hr
- Deps: none

## MEDIUM-risk gaps

### W-6 — Cycle count discrepancy reconciliation page
- Current: Cycle-count records variance but no follow-up workflow
- Fix: New `/ops/portal/warehouse/cycle-count/reconciliation/page.tsx` + CycleCountAdjustment table
- Effort: 4-8hr

### W-7 — Inventory transfer (bay-to-bay) UI
- Current: BayMovement table exists, no UI to execute transfers
- Fix: Transfer modal in bay detail + capacity validation
- Effort: 4-8hr

### W-8 — Loading manifest verification & truck photo
- Current: Daily-plan shows trucks leaving, no manifest checklist or photo evidence
- Fix: New `/ops/warehouse/loading-manifest/page.tsx` + pre-departure checklist + photo upload
- Effort: 1day+

### W-9 — Reservation visibility in job context
- Current: InventoryAllocation tracks per-job, not surfaced on job detail
- Fix: Add allocation panel to `/ops/jobs/[id]/page.tsx`
- Effort: 2-4hr

### W-10 — Stock alerting & low-stock workflow
- Current: GoldStockKit table mentioned but not live
- Fix: Populate from InventoryItem; new `/ops/portal/warehouse/stock-alerts` page; reorder suggestions
- Effort: 4-8hr

### W-11 — Warehouse lead management tools
- Current: Lead is passive observer, no operator tools
- Fix: New `/ops/portal/warehouse/staff-management` dashboard; staff on-shift; pending approvals
- Effort: 1day+

### W-12 — Backhaul/returns workflow
- Current: Returns app exists, no warehouse integration
- Fix: ReturnShipment table + returns bay assignment + carrier pickup scheduling
- Effort: 1day+

### W-13 — Vendor receipt verification & payment-first integration
- Current: Receiving workflow doesn't check vendor payment status
- Fix: Validate paymentStatus in `/api/ops/receiving`; pre-receive checklist
- Effort: 4-8hr

## LOW-risk gaps

### W-14 — Mobile UX for warehouse pages (non pick-scanner)
- Current: Pick-scanner is gold standard; bays/doors/cycle-count are desktop-only
- Fix: Responsive breakpoints + 48px tap targets across `/ops/warehouse/bays`, `/doors`, `/portal/warehouse/cycle-count`
- Effort: 4-8hr

### W-15 — Cross-dock banner on pick scanner
- Current: Banner shown on receiving page, not on pick-scanner (the tech-facing tool)
- Fix: Fetch cross-dock list at scanner load; display banner if job is cross-dock
- Effort: 2-4hr

### W-16 — Daily warehouse briefing (crew huddle)
- Current: Page exists at `/ops/portal/warehouse/briefing`; no data backend
- Fix: Wire daily-plan API; printable standup sheet; "Add Note" form
- Effort: 2-4hr

### W-17 — Inbound schedule visibility
- Current: Daily-plan shows arrivals; no detail page with ETAs/dock conflicts
- Fix: New `/ops/portal/warehouse/receiving-schedule` calendar view
- Effort: 2-4hr

### W-18 — Inventory trend / days-of-supply analysis
- Current: daysOfSupply calculated; no dashboard highlighting trending shortages
- Fix: Add trend section to gold-stock page; "At Risk" filter; 90-day forecast chart
- Effort: 2-4hr

## Quick-win cluster (under 30 min each, ship together)
- W-15 (cross-dock banner): trivial copy from receiving page
- Mobile button-height fixes on bays/doors/cycle-count (find-replace)

## Schema additions
- TruckCheckIn (W-1)
- DamagePhoto (W-2)
- ReceivingDiscrepancy (W-3)
- DoorBayAssignment (W-4)
- CycleCountAdjustment (W-6)
- ReturnShipment (W-12)

## Top 5 highest-impact
1. W-1 truck check-in (foundation for receiving ops)
2. W-2 damage photo capture (legal/insurance protection)
3. W-4 NFC lifecycle + put-away router (transforms manual to intelligent routing)
4. W-3 discrepancy reconciliation (required for order completion accuracy)
5. W-11 lead tools (enables operator role beyond passive observer)
