# AUDIT-C Manufacturing Deep Dive
**Date:** 2026-04-28 | **Launch:** Monday 2026-04-28

## Executive Summary
Manufacturing portal has foundational pages but **15 critical gaps block daily operations**:
- **M-1 HIGH**: Crew Assignment Board (lead cannot see who works what)
- **M-2 HIGH**: Material Substitution Approval (no exception handling)
- **M-3 HIGH**: Production Timer/Clock-In (no labor tracking)
- **M-4 HIGH**: Capacity Dashboard (no bottleneck visibility)
- **M-5 MEDIUM**: Mobile UX (techs forced to desktop)
- **M-6 MEDIUM**: Inline Edit Picks/QC (must navigate away)
- **M-7 MEDIUM**: Staging→LOADED Button (workflow blocked)
- **M-8 MEDIUM**: QC Photos & Defect Categorization (incomplete QC)
- **M-9 MEDIUM**: Rework Workflow (portal disconnected)
- **M-10 MEDIUM**: Real-Time Alerts (no notifications)
- **M-11 LOW**: Cut List & Hardware Tickets (print incomplete)
- **M-12 LOW**: Build Sheet Checklist (assembly tracking)
- **M-13 LOW**: Actual Hours Tracking (labor variance)
- **M-14 LOW**: BOM Cleanup & Validation (data quality)
- **M-15 LOW**: Schedule/Capacity Planning (no forward view)

**Distribution:** 4 HIGH / 6 MEDIUM / 5 LOW | **Effort:** 50-60 engineering hours

---

## Gap Inventory

### M-1: Crew Assignment Board (HIGH, 4-8hr)
**Persona:** Production Lead (Wyatt, Tiffany)

**Current State:**
- Jobs show assignedPMId only; no crew/tech assignment
- No view of who is picking, cutting, assembling, QC-ing

**Proposed Fix:**
- New page: /ops/manufacturing/crew-board
- Schema: add crewAssignedTo, techAssignedTo to Job
- API: /api/ops/manufacturing/crew-board
- UI: group jobs by crew, drag-drop reassign
- **Files:** /src/app/ops/manufacturing/crew-board/page.tsx (NEW), API route (NEW), prisma/schema.prisma

---

### M-2: Material Substitution Approval (HIGH, 2-4hr)
**Persona:** Manufacturing Tech + Lead

**Current State:**
- MaterialPick has SUBSTITUTED status but no request/approval logic
- Techs cannot request swaps

**Proposed Fix:**
- New table: MaterialPickSubstitution
- UI modal: "Request Substitute" with SKU, reason
- Lead dashboard: approval queue
- **Files:** /src/app/ops/manufacturing/picks/page.tsx (modify), /src/app/api/ops/manufacturing/picks/[id]/substitute-request/route.ts (NEW)

---

### M-3: Production Timer/Clock-In (HIGH, 4-8hr)
**Persona:** Manufacturing Tech + Lead

**Current State:**
- Labor costs estimated only; no actual hours tracked
- No start/end times on jobs

**Proposed Fix:**
- Modal: "Start Job" records startedAt
- Timer UI: elapsed time display
- "Clock Out" button: records endedAt
- ProductionEvent table: { jobId, crewId, techId, eventType, duration }
- **Files:** /src/app/api/ops/manufacturing/jobs/[jobId]/clock-in/route.ts (NEW), clock-out (NEW), schema

---

### M-4: Capacity Dashboard (HIGH, 2-4hr)
**Persona:** Production Lead

**Current State:**
- Main dashboard shows KPIs only; no bottleneck view
- No throughput trend or cycle-time analysis

**Proposed Fix:**
- New page: /ops/manufacturing/capacity
- Sections: Queue Depth, Bottleneck, Cycle Time, Utilization, Throughput
- **Files:** /src/app/ops/manufacturing/capacity/page.tsx (NEW), API route (NEW)

---

### M-5: Mobile UX (MEDIUM, 2-4hr)
**Persona:** Manufacturing Tech

**Current State:**
- Desktop-first; minimal mobile responsive
- Techs forced to use desktop

**Proposed Fix:**
- Add md: and sm: Tailwind breakpoints
- Worker mode: large buttons (48px), high contrast
- **Files:** picks, qc, staging pages (modify)

---

### M-6: Inline Edit Picks/QC (MEDIUM, 1-2hr)
**Persona:** Manufacturing Tech

**Current State:**
- Must navigate away to edit pick qty/notes
- QC requires full form submission

**Proposed Fix:**
- Double-click row to edit, blur to save
- Optimistic UI with rollback on error
- **Files:** picks page (modify), qc page (modify)

---

### M-7: Staging→LOADED Button (MEDIUM, 1-2hr)
**Persona:** Production Lead

**Current State:**
- Staging page shows jobs but no "Move to Loaded" button
- Transition logic exists but no UI

**Proposed Fix:**
- Add button + modal on staging page
- Captures delivery date, crew, vehicle
- **Files:** staging page (modify)

---

### M-8: QC Photo & Defect Codes (MEDIUM, 3-4hr)
**Persona:** QC Inspector (Marcus)

**Current State:**
- defectCodes exist but no guidance
- No photo upload field
- Codes only shown in stats, not during entry

**Proposed Fix:**
- File input for photos
- Defect picker modal: categorized codes
- Top 10 quick buttons + custom field
- **Files:** qc page (modify), /src/lib/defect-codes.ts (NEW)

---

### M-9: Rework Workflow (MEDIUM, 3-4hr)
**Persona:** Lead + QC Inspector

**Current State:**
- Portal page exists but disconnected
- No REWORK status; no queue or assignments
- QC fail blocks, not reworks

**Proposed Fix:**
- Add REWORK to Job enum
- JobRework table: { jobId, defectCodes, crewAssigned, status }
- Portal page: shows pending jobs, crew marks complete
- **Files:** rework page (refactor), /src/app/api/ops/manufacturing-command/rework/route.ts, schema

---

### M-10: Real-Time Alerts (MEDIUM, 2-3hr)
**Persona:** Production Lead

**Current State:**
- QC banner requires manual refresh
- No toast on job advance/QC fail
- Lead sees data but no proactive alerts

**Proposed Fix:**
- Toast on every API action
- WebSocket or polling (5s) for KPI refresh
- Toast priority: QC FAIL (red), SHORT (yellow), ACTION (green)
- **Files:** manufacturing page (modify), /src/hooks/useManufacturingToast.ts (NEW)

---

### M-11: Cut List & Hardware Tickets (LOW, 2-3hr)
**Persona:** Manufacturing Tech

**Current State:**
- Job packet prints but missing cut list and hardware pick ticket

**Proposed Fix:**
- Extend print sections: Cut List, Hardware Pick Ticket, Delivery Info
- Use existing @media print CSS
- **Files:** job-packet page (modify)

---

### M-12: Build Sheet Checklist (LOW, 1-2hr)
**Persona:** Assembly Crew

**Current State:**
- Shows assembly groups but no checklist
- No checkboxes for verification

**Proposed Fix:**
- Checklist section: row per component with checkbox
- Interactive on screen, print-friendly
- Progress bar
- **Files:** build-sheet page (modify)

---

### M-13: Actual Hours Tracking (LOW, 2-3hr)
**Persona:** Lead + Finance

**Current State:**
- Labor costs page shows estimates only
- No actual vs. budget comparison

**Proposed Fix:**
- "Actual Hours vs. Budget" section
- Query ProductionEvent for actual hours
- Variance with color coding (red/green)
- CSV export button
- **Files:** labor-costs page (modify)

---

### M-14: BOM Cleanup & Validation (LOW, 1-2hr)
**Persona:** Production Lead

**Current State:**
- No validation; no duplicate/orphan detection
- No cleanup automation

**Proposed Fix:**
- Validation: duplicate SKU warning, missing supplier
- Auto-Clean button: remove zero-qty, consolidate
- Cost rollup: auto-calculate
- Audit trail
- **Files:** bom page (modify), /src/app/api/ops/manufacturing/bom/route.ts

---

### M-15: Schedule/Capacity Planning (LOW, 2-3hr)
**Persona:** Production Lead

**Current State:**
- No forward capacity view
- Lead cannot see over-booking
- Scheduled dates exist but not visualized

**Proposed Fix:**
- New page: /ops/manufacturing/schedule
- Weekly calendar: crews x dates
- Jobs appear as colored blocks (sized by hours)
- Click job for details, drag-drop to reschedule
- **Files:** /src/app/ops/manufacturing/schedule/page.tsx (NEW), API route (NEW)

---

## Quick-Win Cluster (< 30 min each)
Can ship in one batch with minimal dependencies:

1. **M-6**: Inline Edit (1-2hr)
2. **M-7**: Staging Button (1-2hr)
3. **M-11**: Cut List (2-3hr)
4. **M-12**: Checklist (1-2hr)
5. **M-14**: BOM Validation (1-2hr)

**Total:** 8-10 hours | **Ship:** 1-2 weeks

---

## Recommended Ship Sequence

**Week 1 (5 hours):** M-6, M-7, M-11
**Week 2 (12-16 hours):** M-1, M-2, M-5
**Week 3 (10-14 hours):** M-3, M-4, M-10
**Week 4+ (12-16 hours):** M-8, M-9, M-13, M-14, M-15

---

## Schema Changes Required

- Add crewAssignedId, techAssignedId to Job
- New: ProductionEvent, MaterialPickSubstitution, JobRework
- New enum value: JobStatus.REWORK
- Add REWORK, BREAK to ProductionEvent eventType

---

## Risk Summary

| Risk   | Count | Mitigation |
|--------|-------|-----------|
| HIGH   | 4     | Prioritize Weeks 1-2; parallelize M-2+M-7 |
| MEDIUM | 6     | Standard 2-week sprints |
| LOW    | 5     | Can extend or pair with bigger items |

**Total Effort:** 50-60 engineering hours across 4 weeks