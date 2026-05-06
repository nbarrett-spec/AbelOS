# Finance Portal Upgrade Spec — Claude Code Handoff
**Date:** April 28, 2026  
**Author:** Claude (Cowork audit)  
**Requested by:** Nate Barrett  
**Scope:** Payment tracking improvements + all finance portal upgrades  

---

## What Exists Today (Summary)

The finance portal is structurally extensive — 12 pages under `/ops/finance/`, 7 under `/ops/portal/accounting/`, a Collections Action Center, AI Cash Flow Optimizer, executive dashboard, and builder-facing invoice/payment portals. The data model is rich: `Invoice`, `Payment`, `CollectionAction`, `CollectionRule`, `CreditLineTracker`, `CashFlowForecast`, `PaymentOptimization`, `PaymentTermRecommendation`, `InvoiceTimingRule`, `LienRelease`, plus legacy sync models (`HyphenPayment`, `BpwInvoice`, `BwpInvoice`).

**What works well:**
- Invoice CRUD with status state machine (DRAFT → ISSUED → SENT → PARTIALLY_PAID → PAID, with OVERDUE/VOID/WRITE_OFF branches)
- `RecordPaymentModal` on `/ops/invoices` — amount, method (CHECK/ACH/WIRE/CREDIT_CARD/CASH/OTHER), reference field, notes
- Payment API at `/api/ops/invoices/[id]/payments` — atomic transaction, status cascade, state machine guards, audit logging
- Invoice detail at `/ops/invoices/[id]` — shows line items, payment history table (date, method, reference, amount)
- AR Aging Dashboard at `/ops/finance/ar` — six-bucket aging, per-builder drill-down, DSO, heatmap
- AP Waterfall at `/ops/finance/ap` — PO aging, vendor breakdown, "mark paid" modal with method/reference
- Collections system — rules engine, escalation ladder, cron automation, payment plan offers at 45+ days
- Cash Command Center, $1M Scenario Modeler, Financial Optimizer, Company Health, YTD Summary
- Monthly Close workflow at `/ops/portal/accounting/close`
- Builder-facing invoice portal at `/dashboard/invoices` and payment portal at `/dashboard/payments`

---

## PRIORITY 1 — Payment Tracking Improvements (Nate's Primary Ask)

### FIX-1: Add "Record Payment" to AR Dashboard
**Problem:** The AR dashboard at `/ops/finance/ar` is where Dawn works most of the day. It has per-invoice drill-down but the only row actions are "View detail" and "Open in collections." To record a payment, she has to navigate away to `/ops/invoices`, find the invoice again, and click "Record Payment" there.

**Current code:** `src/app/ops/finance/ar/page.tsx` lines 439-454 define `rowActions` with only `view` and `collect`.

**Fix:**
```tsx
// Add to rowActions array in ar/page.tsx
{
  id: 'payment',
  icon: <DollarSign className="w-3.5 h-3.5" />,
  label: 'Record payment',
  shortcut: 'P',
  onClick: (r) => setPaymentInvoice(r),
  show: (r) => r.status !== 'PAID' && r.balanceDue > 0,
},
```
- Import `RecordPaymentModal` from `@/app/ops/components/RecordPaymentModal`
- Add `paymentInvoice` state and the modal at the bottom of the JSX
- On success, refetch AR data

**Effort:** ~30 minutes. The modal and API already exist.

---

### FIX-2: Build Check Register / Payment Ledger Page
**Problem:** No single page shows all recorded payments across all invoices. Dawn can see payments per-invoice on the detail page, but there's no way to search "show me all CHECK payments this month" or "find check #4521."

**Route:** `/ops/finance/payments`

**API:** Create `src/app/api/ops/finance/payments/route.ts`
```sql
SELECT p."id", p."amount", p."method"::text, p."reference", p."receivedAt", p."notes",
       i."invoiceNumber", i."builderId",
       b."companyName" AS "builderName"
FROM "Payment" p
JOIN "Invoice" i ON i."id" = p."invoiceId"
LEFT JOIN "Builder" b ON b."id" = i."builderId"
WHERE 1=1
  -- Optional filters: method, dateFrom, dateTo, builderId, reference search
ORDER BY p."receivedAt" DESC
```

**Page features:**
- Filterable by: method (CHECK/ACH/WIRE/etc.), date range, builder, reference # search
- Columns: Date Received | Method | Reference/Check # | Builder | Invoice # | Amount | Notes
- Summary bar at top: Total Payments (count), Total Amount, Breakdown by method (CHECK: $X, ACH: $Y, etc.)
- CSV export
- Click invoice # → navigate to `/ops/invoices/[id]`
- Click builder name → navigate to `/ops/accounts/[id]`

**Effort:** ~2-3 hours. Straightforward query + DataTable page.

---

### FIX-3: Add "Record Payment" to Invoice Detail Page
**Problem:** The invoice detail page at `/ops/invoices/[id]` shows the payment history table but has NO button to record a new payment from that page. The user has to go back to the list.

**Current code:** `src/app/ops/invoices/[id]/page.tsx` — has payment history table (lines 286-315) but no "Record Payment" action button.

**Fix:**
- Add a "Record Payment" button next to the status badge in the header (line 163 area)
- Only show when `invoice.status !== 'PAID' && invoice.balanceDue > 0`
- Import and use the existing `RecordPaymentModal`
- On success, refetch the invoice

**Effort:** ~20 minutes. The modal exists, just needs to be wired.

---

### FIX-4: Dynamic Check # Label Based on Payment Method
**Problem:** The `RecordPaymentModal` labels the reference field as "Reference # (optional)" regardless of method. When Dawn selects CHECK, the field should say "Check Number"; for ACH it should say "ACH Confirmation #"; for WIRE it should say "Wire Reference #".

**Current code:** `src/app/ops/components/RecordPaymentModal.tsx` line 131.

**Fix:**
```tsx
const referenceLabel = {
  CHECK: 'Check Number',
  ACH: 'ACH Confirmation #',
  WIRE: 'Wire Reference #',
  CREDIT_CARD: 'Transaction ID',
  CASH: 'Receipt # (optional)',
  OTHER: 'Reference # (optional)',
}[method] || 'Reference #'
```
Replace the static label on line 131 with `{referenceLabel}`.

Also: make the reference field **required** when method is CHECK (check number should never be blank for a check payment).

**Effort:** ~15 minutes.

---

### FIX-5: Payment Date Picker (Not Just "Now")
**Problem:** The `RecordPaymentModal` has no date picker. The API sets `receivedAt = NOW()`. But checks are often received days before they're entered — Dawn might be entering Friday's mail on Monday.

**Fix:**
- Add a "Date Received" date input to the modal, defaulting to today
- Pass `receivedAt` in the POST body
- Update the API at `src/app/api/ops/invoices/[id]/payments/route.ts` line 72 to use the provided date:
```sql
VALUES ($1, $2, $3, '${method}'::"PaymentMethod", $4, $5, COALESCE($6::timestamp, NOW()))
```

**Effort:** ~30 minutes.

---

### FIX-6: Batch Payment Recording
**Problem:** When a builder sends one check covering multiple invoices, Dawn has to record payments one at a time. The builder portal at `/dashboard/payments` has batch selection, but the ops side at `/ops/invoices` doesn't.

**Fix:** Add batch payment mode to `/ops/invoices`:
- Checkbox column on each invoice row
- When 1+ invoices selected, show a sticky bottom bar: "X invoices selected — $Y total — Record Batch Payment"
- Click opens a batch payment modal: single check #, single method, single date, auto-distributes amount across selected invoices (oldest first, or proportional)
- API: loop over selected invoice IDs and call the existing payment endpoint for each in a transaction

**Effort:** ~3-4 hours. The per-invoice API exists; this is UI orchestration.

---

## PRIORITY 2 — AR Dashboard Upgrades

### FIX-7: Add "Record Payment" Inline to AR Builder Drill-Down
**Problem:** When Dawn clicks a builder in the AR dashboard and sees their open invoices, there's no payment action there either.

**Fix:** Same pattern as FIX-1 — add the `payment` row action to the invoice DataTable in the builder drill-down view.

---

### FIX-8: AR Dashboard — Show Last Payment Received per Builder
**Problem:** The per-builder breakdown in AR shows total outstanding, invoice count, and aging buckets — but not when the last payment was received. This is critical context for collections.

**Fix:** Add to the AR API query:
```sql
(SELECT MAX(p."receivedAt") FROM "Payment" p 
 JOIN "Invoice" i2 ON i2."id" = p."invoiceId" 
 WHERE i2."builderId" = i."builderId") AS "lastPaymentDate"
```
Display as a column in the builder breakdown table: "Last Payment: Apr 15, 2026"

---

### FIX-9: AR Aging — Add "Send Statement" Bulk Action
**Problem:** No way to send an account statement (list of all open invoices) to a builder directly from the AR page. Dawn has to email them manually.

**Fix:**
- Add "Send Statement" button per builder in the drill-down
- Generates a PDF statement (reuse the builder statement export at `/api/builder/statement/export`) and sends via Resend
- Confirmation modal: "Send statement for Toll Brothers (5 open invoices, $42,350 total) to tollbrothers@contact.com?"

---

## PRIORITY 3 — AP Improvements

### FIX-10: AP — Track Actual Payment Date + Check Number
**Problem:** The AP waterfall at `/ops/finance/ap` tracks PO status and has a "mark paid" modal, but the `PurchaseOrder` model doesn't store payment details (check number we sent, date we paid, payment method).

**Fix:** Add fields to PurchaseOrder model:
```prisma
paidAt        DateTime?
paidMethod    String?     // CHECK, ACH, WIRE
paidReference String?     // our check number or ACH confirmation
paidAmount    Float?
```
- Run Prisma migration
- Update the "mark paid" modal in `/ops/finance/ap` to capture these fields
- Update the AP API to persist and return them

---

### FIX-11: AP — Vendor Payment History
**Problem:** No page shows "all payments we've made to Boise Cascade this year." 

**Fix:** Add payment history section to the vendor detail or create `/ops/finance/ap/payments` mirroring FIX-2 but for outgoing payments. Query PurchaseOrders with `paidAt IS NOT NULL`.

---

## PRIORITY 4 — Invoice Workflow Gaps

### FIX-12: Auto-Generate Invoice from Completed Job
**Problem:** The payment collection workflow on `/ops/invoices` shows Step 2 as "Invoice Generated — Auto-generated from job with line items." But this doesn't actually happen automatically. There's an API at `/api/ops/invoices/from-order` but it requires manual trigger.

**Fix:**
- When a Job advances to stage COMPLETE (or DELIVERED + PM sign-off), auto-create a DRAFT invoice pulling line items from the order's BOM
- Create a cron or webhook trigger: `onJobStatusChange(COMPLETE) → createInvoice()`
- Invoice should populate: builder, job, order link, all line items with pricing, payment term from builder's default

---

### FIX-13: Invoice PDF Generation — Verify & Polish
**Problem:** There's a PDF generation endpoint at `/api/invoices/[id]/pdf` but it's unclear if it produces a professional, printable invoice with Abel Lumber branding.

**Fix:**
- Test the PDF output
- Ensure it includes: Abel Lumber logo + address, builder billing address, invoice number, date, due date, payment terms, line item table (description, qty, unit price, total), subtotal/tax/total, payment instructions (check payable to, ACH details), lien release note
- Match Abel brand tokens (Walnut/Kiln-Oak/Cream palette)

---

### FIX-14: Invoice Email — Send with PDF Attachment
**Problem:** Invoice status can be set to SENT but there's a `/api/ops/invoices/[id]/remind` endpoint — need to verify it actually sends an email with the PDF attached.

**Fix:**
- Verify the remind endpoint sends via Resend with PDF attachment
- Add a "Send Invoice" button on the invoice detail page (only for ISSUED status)
- On send: attach PDF, update status to SENT, log the action in audit trail
- Email template should include: invoice summary, PDF attachment, payment link (Stripe if configured), payment instructions

---

### FIX-15: Void / Write-Off Workflow
**Problem:** The `InvoiceStatus` enum includes VOID and WRITE_OFF but there's no UI to trigger these transitions. Dawn has no way to write off a bad debt or void a duplicate invoice.

**Fix:**
- Add "Void Invoice" action on invoice detail (requires confirmation modal with reason)
- Add "Write Off" action (requires amount, reason, approval from admin)
- Both should update the status via the state machine guard
- Write-offs should create an audit trail entry and optionally a journal entry for QB sync

---

## PRIORITY 5 — Collections Upgrades

### FIX-16: Collections — Show Payment History in Action Panel
**Problem:** The Collections Action Center shows overdue invoices and suggested actions, but doesn't show prior payments on that invoice. Dawn needs to know "they paid $5K of the $12K on March 15" before calling.

**Fix:** Include payment history in the collection action card. The `Payment` model data is already available via the invoice — just surface it in the UI.

---

### FIX-17: Collections — Record Payment Directly from Collections
**Problem:** When Dawn gets a builder on the phone and they say "I'm mailing a check today," she should be able to record the expected payment right there in the Collections Center without navigating away.

**Fix:** Add "Record Payment" action button on each collection item. Reuse `RecordPaymentModal`.

---

### FIX-18: Collections — Builder Contact Info
**Problem:** The Collections Action Center should show the builder's AP contact (name, phone, email) so Dawn can call or email directly from the page.

**Fix:** Join builder contact info in the collections API query. Show phone number and email as clickable `tel:` and `mailto:` links on the action card.

---

## PRIORITY 6 — Lien Release Workflow

### FIX-19: Wire Lien Release to Invoice/Payment Flow
**Problem:** The `LienRelease` model exists with all the right fields (type, status, amount, throughDate, signedDate, signatureData, documentUrl) but the lien releases page at `/ops/lien-releases` shows empty. No lien releases are being created.

**Fix:**
- Auto-create a CONDITIONAL lien release when an invoice is ISSUED
- When payment is received (PAID status), auto-advance the lien release to status READY_TO_SIGN
- Add a lien release section to the invoice detail page showing the linked lien release
- Build a lien release PDF generator (Texas statutory form)
- Add e-signature capture (canvas signature pad component)
- Wire the lien release status to the builder portal so builders can see/download their releases

---

## PRIORITY 7 — QuickBooks Integration

### FIX-20: Complete QB Online OAuth2 Flow
**Problem:** QB integration is at "phase2-stub" — the status endpoint reports readiness but no actual OAuth2 flow exists. The `QBSyncQueue` model and sync infrastructure are built but not connected.

**Current state:**
- `IntegrationConfig` table ready
- `QBSyncQueue` table with status/retry logic built
- Invoice model has `qbTxnId`, `qbSyncedAt`, `qbSyncStatus` fields
- Monthly close has a "QB Synced" checkbox (stub — always succeeds)
- No actual token exchange, no actual transaction push

**Fix (major — estimate 2-3 weeks):**
1. Build OAuth2 authorization flow (redirect → callback → store tokens in `IntegrationConfig`)
2. Implement token refresh cron
3. Build invoice sync: on invoice ISSUED → queue for QB → push as QBO Invoice → store `qbTxnId`
4. Build payment sync: on payment recorded → push as QBO Payment → link to QBO Invoice
5. Build customer sync: map Builders → QBO Customers
6. AR reconciliation: pull QBO AR aging and compare with Aegis AR
7. Update monthly close to actually verify QB sync state

**Note:** This is a significant project. Consider whether this is worth building vs. keeping QB as the manual book of record and Aegis as the operational layer.

---

## PRIORITY 8 — Dashboard & Reporting Upgrades

### FIX-21: Finance Dashboard — Add Quick Actions Strip
**Problem:** The main finance dashboard at `/ops/finance` shows KPIs and charts but has no action shortcuts. Dawn has to navigate the sidebar to find what she needs.

**Fix:** Add a quick-action strip below the KPIs:
- "Record Payment" → opens RecordPaymentModal (with invoice search/select)
- "Create Invoice" → opens CreateInvoiceModal
- "View AR Aging" → navigates to `/ops/finance/ar`
- "Collections Queue" → navigates to `/ops/collections`
- "Monthly Close" → navigates to `/ops/portal/accounting/close`

---

### FIX-22: Cash Command Center — Add Payment Forecast
**Problem:** The Cash Command Center at `/ops/finance/cash` shows trailing 30-day cash flow but doesn't project incoming payments based on invoice due dates and builder payment patterns.

**Fix:**
- Use `PaymentOptimization.avgPaymentDays` per builder to project when each open invoice will likely be paid
- Show as a "Projected Cash Inflows" line on the forecast chart
- Color-code by confidence: high (builder pays on time historically) vs. low (builder is consistently late)

---

### FIX-23: Job Profitability — Add to Job Detail Page
**Problem:** The reports page at `/ops/portal/accounting/reports` has a Job Profitability tab, but individual job detail pages don't show profit margin. A PM looking at a job can't see "this job made us $3,200 or lost us $800."

**Fix:**
- Add a "Profitability" card to the job detail page
- Show: invoice total, COGS (from POs/materials), gross margin ($), gross margin (%)
- Color-code: green if margin > target (e.g., 25%), yellow if 15-25%, red if < 15%

---

### FIX-24: Executive Dashboard — Payment Velocity Metric
**Problem:** The executive financial dashboard at `/ops/executive/financial` shows AR aging and invoice pipeline but not payment velocity — how fast money is actually coming in this week/month vs. prior periods.

**Fix:**
- Add "Payment Velocity" KPI: total payments received this week vs. trailing 4-week average
- Trend indicator: ↑ or ↓ with percentage
- Mini sparkline of weekly payment totals (8 weeks)

---

## PRIORITY 9 — Data Quality & Cleanup

### FIX-25: Remove @placeholder.bolt Emails from Invoice/Payment Contexts
**Problem:** Builder cards on job detail and potentially invoice pages show `@placeholder.bolt` emails from the ECI Bolt migration.

**Fix:** (This is also in the PM audit doc)
```sql
UPDATE "Builder" 
SET "email" = NULL, "updatedAt" = NOW()
WHERE "email" LIKE '%@placeholder.bolt';
```
Display "[No email on file]" in the UI when email is NULL.

---

### FIX-26: Audit $0.00 Invoices
**Problem:** Some invoices may have $0.00 totals if they were created from orders with no pricing.

**Fix:**
- Query: `SELECT * FROM "Invoice" WHERE "total" = 0 AND "status" != 'VOID'`
- For each: check if line items have pricing, fix or void
- Add a data quality check to the invoice creation flow: refuse to create an invoice with $0 total

---

## PRIORITY 10 — Navigation & UX Polish

### FIX-27: Add Finance Sidebar Section for Payments
**Problem:** The finance sidebar has 10 items but no direct link to a payments/check register page.

**Fix:** Add to the Finance nav section in `src/app/ops/layout.tsx`:
```
├── Payment Ledger (💳)  →  /ops/finance/payments
```
Place it after "Accounts Receivable" in the nav order.

---

### FIX-28: Finance Page Consolidation
**Problem:** There are multiple overlapping finance dashboards:
- `/ops/finance` — Financial Dashboard
- `/ops/finance/command-center` — Finance Command Center  
- `/ops/portal/accounting` — Accounting Command Center
- `/ops/finance/cash` — Cash Command Center
- `/ops/cash-flow-optimizer` — AI Cash Flow Brain
- `/ops/finance/health` — Company Financial Health
- `/ops/finance/optimization` — Financial Optimizer

Seven pages with significant overlap. Dawn doesn't know which one to look at.

**Fix:** Consider consolidating into 3 views:
1. **Finance Home** (`/ops/finance`) — KPIs, quick actions, alerts, today's priorities. Merge command-center into this.
2. **Cash & Forecasting** — merge Cash Command Center + AI Cash Flow Brain + AP Forecast
3. **Health & Optimization** — merge Company Health + Financial Optimizer + $1M Modeler

This is a UX redesign, not a code fix. Recommend doing this after the payment tracking improvements ship.

---

### FIX-29: Accounting Portal — Add Role Gating
**Problem:** The accounting portal at `/ops/portal/accounting/` has 7 sub-pages but they're accessible to anyone with ops access. Dawn should see these; PMs shouldn't.

**Fix:** Add role check: only ADMIN, MANAGER, ACCOUNTING roles can access `/ops/portal/accounting/*`.

---

### FIX-30: Invoices Page — Add Builder & Job Columns  
**Problem:** The invoice list shows Invoice #, Builder, Amount, Due Date, Status, Balance — but no Job ID or community/address. When Dawn has 8 invoices for Toll Brothers, she can't tell which house each one is for.

**Fix:** 
- Add Job ID column (link to job detail)
- Add Community/Address column from the linked Job record
- Make both sortable and filterable

---

## Implementation Priority Order

### Week 1 — Payment Tracking (Nate's Ask)
1. FIX-1: Record Payment on AR dashboard (~30 min)
2. FIX-3: Record Payment on invoice detail (~20 min)
3. FIX-4: Dynamic reference label by method (~15 min)
4. FIX-5: Payment date picker (~30 min)
5. FIX-2: Check Register / Payment Ledger page (~3 hrs)
6. FIX-27: Add Payment Ledger to sidebar nav (~10 min)

### Week 2 — Invoice & Collections Flow
7. FIX-6: Batch payment recording (~3-4 hrs)
8. FIX-7: Record Payment in AR drill-down (~30 min)
9. FIX-8: Last payment date per builder (~30 min)
10. FIX-16: Payment history in Collections (~1 hr)
11. FIX-17: Record Payment from Collections (~30 min)
12. FIX-18: Builder contact info in Collections (~30 min)
13. FIX-30: Builder & Job columns on invoices (~1 hr)

### Week 3 — AP & Invoice Workflow
14. FIX-10: AP payment tracking fields (~2 hrs)
15. FIX-12: Auto-generate invoice from completed job (~4 hrs)
16. FIX-13: Invoice PDF verification & polish (~2 hrs)
17. FIX-14: Invoice email with PDF attachment (~2 hrs)
18. FIX-15: Void / Write-Off workflow (~3 hrs)

### Week 4 — Lien Releases & Reports
19. FIX-19: Lien release workflow (~8 hrs)
20. FIX-23: Job profitability on job detail (~2 hrs)
21. FIX-9: Send Statement from AR (~3 hrs)
22. FIX-21: Quick actions on finance dashboard (~1 hr)

### Month 2 — Polish & QB
23. FIX-22: Payment forecast on Cash Command Center (~4 hrs)
24. FIX-24: Payment velocity metric (~2 hrs)
25. FIX-25: Placeholder email cleanup (~30 min)
26. FIX-26: $0 invoice audit (~1 hr)
27. FIX-28: Finance page consolidation (design + build, ~2 weeks)
28. FIX-29: Accounting portal role gating (~1 hr)
29. FIX-11: AP vendor payment history (~3 hrs)
30. FIX-20: QuickBooks Online integration (~2-3 weeks)

---

## Key Files Reference

| Component | Path |
|-----------|------|
| Record Payment Modal | `src/app/ops/components/RecordPaymentModal.tsx` |
| Create Invoice Modal | `src/app/ops/components/CreateInvoiceModal.tsx` |
| Payment API (per invoice) | `src/app/api/ops/invoices/[id]/payments/route.ts` |
| Invoice list page | `src/app/ops/invoices/page.tsx` |
| Invoice detail page | `src/app/ops/invoices/[id]/page.tsx` |
| AR Aging Dashboard | `src/app/ops/finance/ar/page.tsx` |
| AP Waterfall | `src/app/ops/finance/ap/page.tsx` |
| Finance Dashboard | `src/app/ops/finance/page.tsx` |
| Cash Command Center | `src/app/ops/finance/cash/page.tsx` |
| Collections Center | `src/app/ops/collections/page.tsx` |
| AI Cash Flow Optimizer | `src/app/ops/cash-flow-optimizer/page.tsx` |
| Accounting Portal | `src/app/ops/portal/accounting/page.tsx` |
| Monthly Close | `src/app/ops/portal/accounting/close/page.tsx` |
| Builder Invoice Portal | `src/app/dashboard/invoices/page.tsx` |
| Builder Payment Portal | `src/app/dashboard/payments/page.tsx` |
| Lien Releases | `src/app/ops/lien-releases/page.tsx` |
| Sidebar Nav | `src/app/ops/layout.tsx` |
| Prisma Schema | `prisma/schema.prisma` |
| Status Guard | `src/lib/status-guard.ts` |
| Audit Logger | `src/lib/audit.ts` |
| Collections Cron | `src/app/api/cron/collections-cycle/route.ts` |

---

## Existing vs. Missing Summary

| Capability | Status | Notes |
|-----------|--------|-------|
| Record single payment | ✅ EXISTS | Modal + API work, but only accessible from invoice list page |
| Check number tracking | ✅ EXISTS | Via `reference` field on Payment model |
| Payment history per invoice | ✅ EXISTS | Shown on invoice detail page |
| Check register / all-payments view | ❌ MISSING | No page to search across all payments |
| Batch payment recording | ❌ MISSING | Builder portal has it; ops side doesn't |
| Payment date selection | ❌ MISSING | Always records as NOW() |
| Record Payment from AR dashboard | ❌ MISSING | Must navigate to invoices page |
| Record Payment from invoice detail | ❌ MISSING | Detail page shows history but no action |
| Record Payment from Collections | ❌ MISSING | Must navigate away |
| AP payment tracking (our outgoing checks) | ❌ MISSING | PO model has no payment fields |
| Auto invoice from completed job | ❌ MISSING | Manual creation only |
| Invoice PDF (branded) | ⚠️ UNTESTED | Endpoint exists, quality unknown |
| Invoice email sending | ⚠️ UNTESTED | Remind endpoint exists |
| Void/Write-off workflow | ❌ MISSING | Enum values exist, no UI |
| Lien release automation | ❌ MISSING | Model exists, page empty |
| QB sync | ❌ STUB | Phase 2 stub, no actual sync |
| Builder contact in Collections | ❌ MISSING | No phone/email shown |
| Payment forecast (when $ is coming in) | ❌ MISSING | Historical only |
| Job profitability on job detail | ❌ MISSING | Only in reports page |

---

*Generated from deep finance portal audit on April 28, 2026*
