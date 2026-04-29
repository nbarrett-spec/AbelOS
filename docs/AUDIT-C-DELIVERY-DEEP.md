# AUDIT-C — Delivery Deep Dive
**Date:** 2026-04-28
**Scope:** /ops/delivery, /ops/portal/driver, /ops/portal/dispatch, /ops/fleet, all related APIs

## Risk-tier summary
- HIGH: 5 items (D-1 to D-5)
- MEDIUM: 7 items (D-6 to D-12)
- LOW: 4 items (D-13 to D-16)

## HIGH-risk gaps

### D-1 — SMS notifications (driver & builder)
- Persona: Driver, builder, dispatch
- Current: DeliveryNotification model only supports EMAIL
- Fix: Twilio integration; SMS provider; driver opt-in preferences; ETA/arrival SMS
- Effort: 1day+
- Deps: Twilio account/keys

### D-2 — Real-time damage & exception reporting at site
- Persona: Driver, dispatch, PM
- Current: Signature capture only; damageNotes is unstructured text
- Fix: DeliveryException table; damage category enum; conditional photo upload; auto-escalation to PM
- Effort: 1day+
- Deps: none

### D-3 — Failed delivery retry workflow & reason tracking
- Persona: Dispatch, customer service
- Current: RESCHEDULED status exists; no retry logic, reasons, or policy
- Fix: Retry reason enum; max retry counter; auto-retry scheduling; escalation after 3 failures
- Effort: 1day+
- Deps: none

### D-4 — Vehicle health & inspection checks pre-departure
- Persona: Driver, mechanic, fleet manager
- Current: Fleet page shows static info; no pre-trip checklist or block-on-fail
- Fix: VehicleInspection + VehicleIssue tables; mobile checklist; departure gate
- Effort: 1day+
- Deps: none

### D-5 — Address verification & geocoding at dispatch time
- Persona: Driver, dispatch
- Current: Addresses stored as-is; route optimizer uses heuristic distance
- Fix: Google Maps API for standardization + geocoding; lat/lon storage; invalid address detection
- Effort: 1day+
- Deps: Google Maps API key

## MEDIUM-risk gaps

### D-6 — Delivery KPI dashboard with crew breakdown
- Current: Optimize page shows volume but no crew-level KPIs
- Fix: New `/api/ops/delivery/kpis` route; crew leaderboard; on-time %, stops/hr
- Effort: 4-8hr

### D-7 — Dispatch live alert system for exceptions/delays
- Current: No alerts for delays > 30min, vehicle immobile > 10min
- Fix: Alert trigger logic + WebSocket/polling delivery to dispatch UI
- Effort: 2-4hr

### D-8 — Dispatch live map visualization
- Current: Crew cards show coordinates but no map
- Fix: Leaflet/Google Maps embed; live markers; clustering; ETA circles
- Effort: 1day+
- Deps: Map library decision

### D-9 — Hours-of-service & mileage logging
- Persona: Driver, fleet, compliance
- Current: No HOS tracking; mileage estimated heuristically
- Fix: DriverShift + HosEntry tables; auto-log; break timer; weekly HOS report; DOT export
- Effort: 1day+

### D-10 — Pre-load verification & manifest signing
- Persona: Driver, warehouse lead
- Current: Manifest print available; no pre-load gate
- Fix: PreLoadVerification table; item-level checks; signature before departure; capacity validation
- Effort: 4-8hr

### D-11 — Backhaul load matching & reverse route optimization
- Current: All routes assume empty return
- Fix: BackhaulLoad table; geofence matching; reverse route optimizer; cost savings calc
- Effort: 1day+

### D-12 — Driver training & onboarding tracking
- Current: No formal onboarding; manually briefed
- Fix: DriverTraining + TrainingCourse tables; training module UI; renewal alerts
- Effort: 4-8hr

## LOW-risk gaps

### D-13 — Exception categorization & team routing
- Current: damageNotes unstructured; no triage
- Fix: DeliveryException enum; auto-categorize; route to QA/CS/logistics/mechanic; SLA timer
- Effort: 2-4hr

### D-14 — Delivery window compatibility & communication
- Current: Window stored but not validated against route ETA
- Fix: ETA-window validation API; pre-delivery builder notification; window extension request
- Effort: 2-4hr

### D-15 — Proof of delivery archive & compliance retrieval
- Current: Signature/photos uploaded; no structured POD package
- Fix: POD zip generation (manifest + photos + signature + tracking log); searchable index
- Effort: 2-4hr

### D-16 — Contact verification & escalation for unresponsive customers
- Current: Builder contact phone shown; no validation/escalation
- Fix: Contact table primary/secondary; CallLog; escalation rule engine; "left at" waiver
- Effort: 2-4hr

## Quick-win cluster (under 30 min each)
- D-13 categorization enum + dropdown (additive)
- D-15 POD search endpoint (DB query only)

## Schema additions
- DeliveryException + categories (D-2, D-13)
- DeliveryRetry reason enum (D-3)
- VehicleInspection + VehicleIssue (D-4)
- DriverShift + HosEntry (D-9)
- PreLoadVerification (D-10)
- BackhaulLoad (D-11)
- DriverTraining + TrainingCourse (D-12)

## Top 5 highest-impact
1. D-2 real-time damage reporting (highest customer escalation driver)
2. D-3 failed delivery retry (10-15% of deliveries fail with no recovery loop)
3. D-5 address verification (route optimizer accuracy hinges on this)
4. D-10 pre-load verification (prevents wrong-item dispatches)
5. D-9 HOS/mileage logging (regulatory compliance, driver safety liability)
