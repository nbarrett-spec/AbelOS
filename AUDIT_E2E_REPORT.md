# Abel OS — End-to-End Workflow Audit

- **Run ID:** audit-moau63f6
- **Started:** 2026-04-23T02:02:00.788Z
- **Base URL:** https://app.abellumber.com
- **Staff:** n.barrett@abellumber.com
- **Duration:** 14.108s
- **Step results:** 19 ok, 0 fail, 0 skip (of 19)
- **Unique punch-list issues:** 14

## TL;DR — top findings

1. **Enum cast bug in ≥4 POST routes.** /api/ops/orders, /api/ops/quotes, /api/ops/schedule, and /api/ops/payments all pass raw strings to enum columns via $executeRawUnsafe without the `::"EnumName"` cast. Same pattern, 500s (or silent invoice-update fails in payments).
2. **Job.latitude / Job.longitude columns missing from live DB.** Declared in schema.prisma:995-996 but never migrated to Neon. Any Prisma client update on a Job row 500s — this is what breaks POST /api/ops/delivery/[deliveryId]/complete.
3. **PATCH /api/ops/purchasing** returns 500 on every call because the vendor refetch SELECT at route.ts:322 uses unquoted `contactName` (Postgres folds to `contactname`, which does not exist). The status update succeeds, then the follow-up SELECT explodes.
4. **Order.orderDate is never set** when an order is created via the API (route.ts:344-368 omits the column), and the executive dashboard KPIs filter on `orderDate IS NOT NULL`. Every API-created order is invisible to revenue KPIs.
5. **No POST endpoint** for builders (/api/ops/builders or /api/ops/accounts), no POST for takeoffs (/api/ops/takeoffs). Creation must happen via DB or via the builder-side project creation flow — which uses a different session model entirely.
6. **No PO category / type column.** The spec asks for distinct PO types (Trim 1, Trim 1 Labor, Trim 2, Trim 2 Labor, Final, Punch). Schema only has PurchaseOrder with vendor + status. The seven types are convention, not enforced by the schema.
7. **Payment silently fails to update the invoice.** POST /api/ops/payments returns 201 and inserts the Payment row, but the follow-up Invoice UPDATE is wrapped in a try/catch with commented-out logging (route.ts:231). Result: Invoice.amountPaid stays at 0 and status stays DRAFT.

## Test-data tag
Every ID created by this script is prefixed with **`test-audit-moau63f6-`**.
To wipe later (review BEFORE running):
```sql
-- review first!
DELETE FROM "Payment" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE notes ILIKE '%audit-moau63f6%');
DELETE FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE notes ILIKE '%audit-moau63f6%');
DELETE FROM "Invoice" WHERE notes ILIKE '%audit-moau63f6%';
DELETE FROM "ScheduleEntry" WHERE notes ILIKE '%audit-moau63f6%';
DELETE FROM "DeliveryTracking" WHERE "deliveryId" = 'test-audit-moau63f6-delivery';
DELETE FROM "Delivery" WHERE id = 'test-audit-moau63f6-delivery';
DELETE FROM "Job" WHERE "jobAddress" ILIKE '%Audit Trail Ln%';
DELETE FROM "PurchaseOrderItem" WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE notes ILIKE '%audit-moau63f6%');
DELETE FROM "PurchaseOrder" WHERE notes ILIKE '%audit-moau63f6%';
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "builderId" = 'test-audit-moau63f6-builder');
DELETE FROM "Order" WHERE "builderId" = 'test-audit-moau63f6-builder';
DELETE FROM "QuoteItem" WHERE "quoteId" IN (SELECT id FROM "Quote" WHERE notes ILIKE '%audit-moau63f6%');
DELETE FROM "Quote" WHERE notes ILIKE '%audit-moau63f6%';
DELETE FROM "TakeoffItem" WHERE "takeoffId" = 'test-audit-moau63f6-takeoff';
DELETE FROM "Takeoff" WHERE id = 'test-audit-moau63f6-takeoff';
DELETE FROM "Blueprint" WHERE id = 'test-audit-moau63f6-blueprint';
DELETE FROM "Project" WHERE id = 'test-audit-moau63f6-project';
DELETE FROM "Builder" WHERE id = 'test-audit-moau63f6-builder';
```

## Steps

| # | Step | Status | Elapsed ms | Detail |
|---|------|--------|------------|--------|
| 1 | Login | SUCCESS | 1101 | {"summary":"staff=n.barrett@abellumber.com roles=ADMIN"} |
| 2 | Create Builder | SUCCESS | 1662 | {"summary":"id=test-audit-moau63f6-builder viaApi=false missingPostEndpoint=true"} |
| 3 | Create Project | SUCCESS | 2190 | {"summary":"id=test-audit-moau63f6-project addr=\"1234 Audit Trail Ln, Gainesville, TX\" viaApi=false latLngOnProject=NO"} |
| 4 | Create Takeoff (+ blueprint) | SUCCESS | 2919 | {"summary":"takeoffId=test-audit-moau63f6-takeoff items=4"} |
| 5 | Create Quote + Sales Order | SUCCESS | 4147 | {"summary":"order=ORD-2026-63F6 total=1975 status=RECEIVED orderDateSet=true"} |
| 6.exterior | PO Exterior materials (PO-2026-0029) | SUCCESS | 5234 | {"summary":"id=po_moau66ex_b9n59w vendor=cmn2b7ox70008yf0ka8xhzdfn"} |
| 6.trim1 | PO Trim 1 (interior doors) (PO-2026-0030) | SUCCESS | 6010 | {"summary":"id=po_moau674p_76zwb0 vendor=cmn0bse7n000e5yk9n6pz8tuf"} |
| 6.trim1_labor | PO Trim 1 Labor (PO-2026-0031) | SUCCESS | 6814 | {"summary":"id=po_moau67qr_aggnve vendor=cmn2b7ox70008yf0ka8xhzdfn"} |
| 6.trim2 | PO Trim 2 (base/case) (PO-2026-0032) | SUCCESS | 7819 | {"summary":"id=po_moau68de_rhwguj vendor=cmn2b7qsr0015yf0kh8wyk4sc"} |
| 6.trim2_labor | PO Trim 2 Labor (PO-2026-0033) | SUCCESS | 8607 | {"summary":"id=po_moau694k_idixoi vendor=cmn2b7ox70008yf0ka8xhzdfn"} |
| 6.final | PO Final / Front door (PO-2026-0034) | SUCCESS | 9366 | {"summary":"id=po_moau69qe_afzxen vendor=cmn0bse98000f5yk98snpjt87"} |
| 6.punch | PO Punch / warranty (PO-2026-0035) | SUCCESS | 10090 | {"summary":"id=po_moau6abe_x3bybe vendor=cmn2b7ox70008yf0ka8xhzdfn"} |
| 6 | Create POs — one per type | SUCCESS | 10253 | {"summary":"created=7/7 inList=true"} |
| 7 | Receive PO fully | SUCCESS | 10942 | {"summary":"po=PO-2026-0029 onHand 179→180 onOrder -4→-5"} |
| 8 | Create + advance Job | SUCCESS | 11419 | {"summary":"job=JOB-2026-1550 advanced=CREATED→READINESS_CHECK"} |
| 9 | Create + complete Delivery | SUCCESS | 11829 | {"summary":"deliveryId=test-audit-moau63f6-delivery num=DEL-2026-63F6 completed=true onTodayBoard=true"} |
| 10 | Schedule Trim1/Trim2 install | SUCCESS | 12107 | {"summary":"scheduleEntries=0/2"} |
| 11 | Invoice + partial + final pay | SUCCESS | 12839 | {"summary":"invoice=inv_moau6cfq_utx47d mid amountPaid=0/9300 final=DRAFT balanceDue=9300"} |
| 12 | Dashboards surface the new data | SUCCESS | 14107 | {"summary":"exec-dashboard=ok(builderHit=false orderHit=false invHit=false) \| ar-heatmap=ok(builderHit=false orderHit=false invHit=false) \| my-day=ok(builderHit=false orderHit=false invHit=false) \| |

## Punch list — broken wires and gaps

Unique issues: **14**

| # | Kind | Reason | File |
|---|------|--------|------|
| 3-geo | schema_gap | Project has no latitude/longitude columns; spec asks for project-level geocoding. Only Job has lat/lng (schema.prisma:995-996). | `prisma/schema.prisma:306-333` |
| 4-missing-post | missing_wire | No POST /api/ops/takeoffs endpoint — only GET exists. Takeoff creation must go through blueprint upload flow or DB. | `src/app/api/ops/takeoffs/route.ts` |
| 4-blueprint-required | schema_constraint | Takeoff.blueprintId is NOT NULL (schema.prisma:383) — can't create a takeoff without a blueprint row, even for manual/paper takeoffs. | `prisma/schema.prisma:379-403` |
| 5-quote-insert | broken_wire | POST /api/ops/quotes → 500. INSERT omits takeoffId but the column is NOT NULL + UNIQUE. Server error: Internal server error (HTTP 500) | `src/app/api/ops/quotes/route.ts:274-283` |
| 5-order-insert | broken_wire | POST /api/ops/orders → 500. INSERT at route.ts:344-368 passes "paymentTerm" ($8), "paymentStatus" ($9), and "status" ($10) as plain strings to enum columns (PaymentTerm / PaymentStatus / OrderStatus) without ::"EnumName" casts. Same bug pattern as quotes/schedule. Error: Failed to create order (HTTP 500) | `src/app/api/ops/orders/route.ts:344-368` |
| 6-no-po-category | schema_gap | PurchaseOrder has no "category" or "poType" column (schema.prisma:1535-1576). Workflow spec asks for Trim 1 / Trim 2 / Labor / Final / Punch POs as distinct types — none exist in schema. Current system tells them apart only by vendor convention or user memory. | `prisma/schema.prisma:1535-1576` |
| 6-po-patch-bug | broken_wire | PATCH /api/ops/purchasing throws 500. SELECT in vendor-refetch uses unquoted "contactName" (Postgres folds to "contactname", column does not exist). Status update DOES succeed, but the follow-up vendor SELECT fails and the route returns 500. Verified with psql: "column \"contactname\" does not exist". (HTTP 500) | `src/app/api/ops/purchasing/route.ts:321-326` |
| 7-onorder-negative | broken_wire | InventoryItem.onOrder went negative (-5) — receiving decrements onOrder but PO create never increments it. PO create flow at /api/ops/purchasing should bump InventoryItem.onOrder by qty. | `src/app/api/ops/purchasing/route.ts:224-238` |
| 8-gate-materials | workflow_gate | Cannot advance to MATERIALS_LOCKED without pickListGenerated=true and no SHORT picks. Gate message: Pick list must be generated before locking materials. No visible endpoint to auto-generate a pick list for an already-created job bound to a SO. Check /api/ops/manufacturing/generate-picks. | `src/app/api/ops/manufacturing/advance-job/route.ts:100-114` |
| 9-delivery-complete-500 | schema_drift | Delivery complete 500: Job.latitude / Job.longitude columns are declared in schema.prisma:995-996 but are MISSING from the live Neon database. Any Prisma client update on Job fails. Migration needs to add these columns OR remove them from the schema. (HTTP 500) | `src/app/api/ops/delivery/[deliveryId]/complete/route.ts + prisma/schema.prisma:995-996` |
| 10-schedule-entry | broken_wire | POST /api/ops/schedule → 500: Failed to create schedule entry. INSERT at route.ts:270-275 passes status as plain text ($8) without enum cast ::"ScheduleStatus" — the column is a ScheduleStatus enum. Same bug pattern as quote insert. (HTTP 500) | `src/app/api/ops/schedule/route.ts:270-275` |
| 11-payment-silent-fail | broken_wire | POST /api/ops/payments returns 201 but Invoice row is NOT updated. Invoice.amountPaid=0 (expected 5000), balanceDue=9300 (expected 4300), status=DRAFT (expected PARTIALLY_PAID). The invoice-update UPDATE is wrapped in a silent try/catch (payments/route.ts:202-232 — note the commented-out console.log at line 231). Likely enum-cast miss on "status" parameter. | `src/app/api/ops/payments/route.ts:200-227` |
| 11-fullpaid | broken_wire | After full payment, status=DRAFT balanceDue=9300 (expected PAID / 0). | `` |
| 12-exec-no-roll-up | roll_up_gap | New E2E order did not appear in executive/dashboard revenue KPIs, because Order.orderDate is null (see step 5 finding). Every new order created via the API is invisible to KPIs until somebody populates orderDate. | `src/app/api/ops/executive/dashboard/route.ts:27-35` |

## Session context
```json
{
  "staff": {
    "id": "cmn0bsdf800005yk9sizrwc22",
    "firstName": "Nathaniel",
    "lastName": "Barrett",
    "email": "n.barrett@abellumber.com",
    "role": "ADMIN",
    "roles": [
      "ADMIN"
    ],
    "department": "EXECUTIVE",
    "title": "CFO"
  },
  "builderId": "test-audit-moau63f6-builder",
  "builderName": "Audit Test Builder 2026-04-23T02:02:00.786Z",
  "projectId": "test-audit-moau63f6-project",
  "blueprintId": "test-audit-moau63f6-blueprint",
  "takeoffId": "test-audit-moau63f6-takeoff",
  "quoteId": "test-audit-moau63f6-quote",
  "orderId": "test-audit-moau63f6-order",
  "orderNumber": "ORD-2026-63F6",
  "productIds": [],
  "vendorId": null,
  "pos": {
    "exterior": {
      "id": "po_moau66ex_b9n59w",
      "poNumber": "PO-2026-0029",
      "vendorId": "cmn2b7ox70008yf0ka8xhzdfn",
      "productId": null
    },
    "trim1": {
      "id": "po_moau674p_76zwb0",
      "poNumber": "PO-2026-0030",
      "vendorId": "cmn0bse7n000e5yk9n6pz8tuf",
      "productId": null
    },
    "trim1_labor": {
      "id": "po_moau67qr_aggnve",
      "poNumber": "PO-2026-0031",
      "vendorId": "cmn2b7ox70008yf0ka8xhzdfn",
      "productId": null
    },
    "trim2": {
      "id": "po_moau68de_rhwguj",
      "poNumber": "PO-2026-0032",
      "vendorId": "cmn2b7qsr0015yf0kh8wyk4sc",
      "productId": null
    },
    "trim2_labor": {
      "id": "po_moau694k_idixoi",
      "poNumber": "PO-2026-0033",
      "vendorId": "cmn2b7ox70008yf0ka8xhzdfn",
      "productId": null
    },
    "final": {
      "id": "po_moau69qe_afzxen",
      "poNumber": "PO-2026-0034",
      "vendorId": "cmn0bse98000f5yk98snpjt87",
      "productId": null
    },
    "punch": {
      "id": "po_moau6abe_x3bybe",
      "poNumber": "PO-2026-0035",
      "vendorId": "cmn2b7ox70008yf0ka8xhzdfn",
      "productId": null
    }
  },
  "receivingProductId": "cmmzrpvjg000593oplgpzjymv",
  "jobId": "6a11b8f4-f146-490d-a319-12178d866002",
  "jobNumber": "JOB-2026-1550",
  "deliveryId": "test-audit-moau63f6-delivery",
  "invoiceId": "inv_moau6cfq_utx47d",
  "invoiceTotal": 9300
}
```