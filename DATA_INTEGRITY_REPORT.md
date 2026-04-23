# Abel OS — Data Integrity Audit

**Generated:** 2026-04-23T03:05:46.807Z
**Script:** `scripts/db-integrity-audit.mjs` (READ-ONLY)
**Duration:** 21.7s  ``  **Rows scanned:** 13,431

## Summary

| Severity | Count |
|---|---|
| P0 (breaking) | 2 |
| P1 (data accuracy) | 13 |
| P2 (informational / minor) | 11 |
| **Total findings** | **26** |

## P0 — Breaking: data is actively wrong or required fields missing

### A. Orphaned FK

#### Invoice — Invoice.builderId -> Builder.id: 22 orphan rows

- **Count:** 22
- **Sample:** `cmn229jdv00d4upbrhrbc53yz`, `inv_mn7qw5j8_ad8604`, `inv_mn7qz2op_onxhf9`, `inv_mn7qz30t_8dstro`, `inv_mn7qz3cl_m6lau6`
- **Impact:** Invoices with no builder — AR aging & collections broken.

```sql
-- Required FK — MANUAL TRIAGE. Review and either recreate the parent Builder record(s), or delete the orphaned Invoice rows:
-- SELECT * FROM "Invoice" WHERE "builderId" NOT IN (SELECT "id" FROM "Builder") LIMIT 50;
-- Potential delete (use only after verifying the rows are truly abandoned):
-- DELETE FROM "Invoice" WHERE "builderId" IS NOT NULL AND "builderId" NOT IN (SELECT "id" FROM "Builder");
```

### B. Derived-field drift

#### Invoice — Invoice.amountPaid disagrees with SUM(Payment.amount) on 7+ rows.

- **Count:** 7
- **Sample:** `inv_mn7qw5j8_ad8604`, `inv_moatvfbf_t08nmm`, `inv_moau1zw0_kf00sb`, `inv_moau3l85_gbe05t`, `inv_moau4x2b_4dn0o3`
- **Impact:** Cash applied is misreported. Over/underpayment reports wrong. Collection tickets may chase paid invoices (or miss unpaid ones).

```sql
UPDATE "Invoice" i
SET "amountPaid" = COALESCE(p.paid,0),
    "balanceDue" = i."total" - COALESCE(p.paid,0),
    "updatedAt" = now()
FROM (
  SELECT "invoiceId", SUM("amount")::float AS paid FROM "Payment" GROUP BY "invoiceId"
) p
WHERE p."invoiceId" = i."id" AND ABS(COALESCE(i."amountPaid",0) - COALESCE(p.paid,0)) > 0.01;
```

## P1 — Data accuracy: fix within days

### B. Derived-field drift

#### Order — Order.subtotal disagrees with SUM(OrderItem.lineTotal) by >$0.01 on 200+ rows (capped at 200).

- **Count:** 200
- **Sample:** `0d29a8c7-78f9-4a76-b32c-66251ac7988a`, `3a9d1d64-9449-4356-ac30-6751db910a03`, `3aeae86e-e68b-4a6c-86c0-221f4a09a4a3`, `3f2692e3-0c01-4266-8cf9-7ad2fc66a7b4`, `47361146-a6e0-42a4-87f7-93677faa714e`
- **Impact:** Sales reports and AR aging may show wrong totals; syncs to QuickBooks/InFlow may replay stale values.

```sql
-- Recompute Order.subtotal from OrderItem.lineTotal sums
UPDATE "Order" o
SET "subtotal" = sub.derived,
    "total" = sub.derived + COALESCE(o."taxAmount",0) + COALESCE(o."shippingCost",0),
    "updatedAt" = now()
FROM (
  SELECT "orderId" AS id, COALESCE(SUM("lineTotal"),0) AS derived
  FROM "OrderItem" GROUP BY "orderId"
) sub
WHERE o."id" = sub.id AND ABS(o."subtotal" - sub.derived) > 0.01;
```

#### PurchaseOrder — PurchaseOrder.subtotal disagrees with SUM(PurchaseOrderItem.lineTotal) on 60+ rows.

- **Count:** 60
- **Sample:** `cmn2bpaht0eeayf0kgh0yn5f8`, `cmn2brzzb0hpiyf0kfhcn93cz`, `cmn2by9ni0n08yf0k0vtqttd9`, `4faeac3e-601d-4e61-a449-e0ce7023f62f`, `a3ae3b83-c2e2-4aa3-a75c-f37af3f54d11`
- **Impact:** Vendor spend and AP accruals may be wrong; purchasing dashboards miscategorize.

```sql
UPDATE "PurchaseOrder" p
SET "subtotal" = COALESCE(sub.derived,0),
    "total" = COALESCE(sub.derived,0) + COALESCE(p."shippingCost",0),
    "updatedAt" = now()
FROM (
  SELECT "purchaseOrderId" AS id, COALESCE(SUM("lineTotal"),0) AS derived
  FROM "PurchaseOrderItem" GROUP BY "purchaseOrderId"
) sub
WHERE sub.id = p."id" AND ABS(COALESCE(p."subtotal",0) - COALESCE(sub.derived,0)) > 0.01;
```

#### PurchaseOrder — PurchaseOrder.total disagrees with subtotal + shippingCost on 5+ rows.

- **Count:** 5
- **Sample:** `4faeac3e-601d-4e61-a449-e0ce7023f62f`, `6d836399-03de-4fa7-a871-f8713ec075d5`, `e6eb698b-e467-4cc4-985d-3b63a49ff516`, `4c1c5305-9baa-4864-829d-112c9c524ae7`, `e2e8fc86-abc6-4d9e-96a6-490f5f54070d`
- **Impact:** AP / cash flow forecast miscalculated.

```sql
UPDATE "PurchaseOrder"
SET "total" = COALESCE("subtotal",0) + COALESCE("shippingCost",0), "updatedAt" = now()
WHERE ABS("total" - (COALESCE("subtotal",0) + COALESCE("shippingCost",0))) > 0.01;
```

#### InventoryItem — InventoryItem.onOrder disagrees with open PO line quantities on 186+ SKUs.

- **Count:** 186
- **Sample:** `cmn0so77k03np3v60im3983v9`, `cmn0so7rr03o73v6059yz5ayv`, `cmn0so8s903p03v60nbxfhhm0`, `cmn0so98103p93v60y0ax6k97`, `cmn0so9o303pj3v60bnsn0129`
- **Impact:** Reorder suggestions & auto-purchase recommendations will be wrong.

```sql
UPDATE "InventoryItem" i
SET "onOrder" = COALESCE(v.open_qty,0), "updatedAt" = now()
FROM (
  SELECT poi."productId", SUM(GREATEST(COALESCE(poi."quantity",0) - COALESCE(poi."receivedQty",0), 0))::int AS open_qty
  FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  WHERE po."status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED') AND poi."productId" IS NOT NULL
  GROUP BY poi."productId"
) v
WHERE v."productId" = i."productId" AND COALESCE(i."onOrder",0) <> COALESCE(v.open_qty,0);
-- Also zero out SKUs with no open PO lines:
UPDATE "InventoryItem" SET "onOrder" = 0, "updatedAt" = now()
WHERE COALESCE("onOrder",0) <> 0 AND "productId" NOT IN (
  SELECT DISTINCT poi."productId" FROM "PurchaseOrderItem" poi
  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  WHERE po."status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED') AND poi."productId" IS NOT NULL
);
```

### C. Timestamp ordering

#### PurchaseOrder — PurchaseOrder.orderedAt after receivedAt on 128+ rows.

- **Count:** 128
- **Sample:** `cmn2brzzb0hpiyf0kfhcn93cz`, `cmn99gs3b0qf0q67b1fjayfqv`, `cmn99cbwe0p48q67bexof5bqc`, `cmn99ftbp0q4tq67bhxyv6hwz`, `cmn998cau0o1cq67bklxaj4bf`
- **Impact:** Impossible — received before ordered. Skews vendor lead-time metrics.

```sql
-- No universal fix. Inspect and decide to clear one of the fields:
-- SELECT "id","orderedAt","receivedAt" FROM "PurchaseOrder" WHERE "orderedAt" > "receivedAt" LIMIT 50;
```

### D. Duplicates

#### Builder — 1 distinct companyName (case-insensitive, trimmed) with duplicates — 3 rows total.

- **Count:** 3
- **Sample:** `test-probe-moaw5r5w-b`, `test-probe-moaw68vn-b`
- **Impact:** Orders/invoices split across builder copies; AR/margin reports undercount per builder; credit hold logic bypassed if wrong shell is referenced.

```sql
-- Manual dedup — pick the keeper with most activity, reassign FKs, then soft-delete orphans. Sample inspection:
-- SELECT LOWER(TRIM("companyName")) key, array_agg("id" ORDER BY "createdAt") ids FROM "Builder" GROUP BY 1 HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC LIMIT 50;
-- Use scripts/dedup-builders.mjs (existing) as starting point.
```

### E. Required fields NULL

#### Invoice — Invoice.issuedAt is NULL on 3 rows where status != DRAFT — issued invoices must have issue date.

- **Count:** 3
- **Sample:** `inv_moauqod6_omeh5y`, `inv_moautga0_tpnoy0`, `inv_moautxf3_d7nw19`
- **Impact:** DSO and aging calculations miscount these invoices.

```sql
-- Backfill from createdAt as a best-guess:
UPDATE "Invoice" SET "issuedAt" = "createdAt", "updatedAt" = now()
WHERE "issuedAt" IS NULL AND "status" <> 'DRAFT';
```

#### PurchaseOrder — PurchaseOrder.orderedAt is NULL on 42 rows where status is past approval — should be set when PO goes to vendor.

- **Count:** 42
- **Sample:** `po_moau1uq5_m49zsq`, `po_moau1wfz_3f34m2`, `po_moau1vb4_2rloav`, `po_moau1vuz_en511q`, `po_moau1x06_l4f4t9`
- **Impact:** Vendor lead-time metrics miscalculated.

```sql
-- Backfill from createdAt when orderedAt is NULL on non-draft POs:
UPDATE "PurchaseOrder" SET "orderedAt" = "createdAt", "updatedAt" = now()
WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED');
```

### H. Temporal coverage

#### Delivery — 204 Deliveries with status=COMPLETE but completedAt IS NULL.

- **Count:** 204
- **Impact:** OTD metric and delivery throughput mis-measured.

```sql
-- Backfill from arrivedAt or updatedAt:
UPDATE "Delivery" SET "completedAt" = COALESCE("arrivedAt","updatedAt"), "updatedAt" = now()
WHERE "status" = 'COMPLETE' AND "completedAt" IS NULL;
```

### I. Status coherence

#### Order — 3198 Orders in DELIVERED state without a linked Invoice.

- **Count:** 3198
- **Sample:** `c4670871-a747-54aa-a339-e2ee0d729eed`, `16e041c7-c8b6-56a4-9485-b6135933b255`, `cmo6m0y2k07xn5uq8otu7mctv`, `cmo6m15cu081f5uq87fbk1208`, `cmo6m1r7g08ki5uq87eyxl2l2`
- **Impact:** Revenue delivered but not billed — unbilled revenue / missed AR.

```sql
-- Investigate. Possibly needs invoice auto-gen. Sample list:
-- SELECT "id","orderNumber","builderId","total" FROM "Order" WHERE "status" = 'DELIVERED' AND "id" NOT IN (SELECT "orderId" FROM "Invoice" WHERE "orderId" IS NOT NULL) LIMIT 50;
```

#### Invoice — 5 DRAFT invoices have Payments attached (impossible in normal flow).

- **Count:** 5
- **Sample:** `inv_moatvfbf_t08nmm`, `inv_moau1zw0_kf00sb`, `inv_moau3l85_gbe05t`, `inv_moau4x2b_4dn0o3`, `inv_moau6cfq_utx47d`
- **Impact:** Payment applied to unfinalized invoice. Likely revenue reported in wrong period.

```sql
-- Move these invoices to ISSUED or PAID based on payments:
UPDATE "Invoice" i
SET "status" = CASE WHEN COALESCE(i."amountPaid",0) >= COALESCE(i."total",0) - 0.01 THEN 'PAID' ELSE 'ISSUED' END,
    "issuedAt" = COALESCE(i."issuedAt", i."createdAt"),
    "updatedAt" = now()
WHERE i."status" = 'DRAFT' AND i."id" IN (SELECT DISTINCT "invoiceId" FROM "Payment");
```

#### PurchaseOrder — 200 POs marked RECEIVED but at least one line is under-received.

- **Count:** 200
- **Sample:** `cmn2bjbfj06ezyf0kuioqf56q`, `cmn2bjbxd06fpyf0ksu7y45g5`, `cmn2bjhbf06lqyf0kc3zu62fa`, `cmn2bjhrd06mbyf0kgmijq13h`, `cmn2bji1h06mqyf0k4vc8vcy4`
- **Impact:** Inventory-on-order will be wrong; receipt shouldn't have closed the PO.

```sql
-- Move back to PARTIALLY_RECEIVED; receiving flow will close when lines settle:
UPDATE "PurchaseOrder" SET "status" = 'PARTIALLY_RECEIVED', "updatedAt" = now()
WHERE "status" = 'RECEIVED' AND "id" IN (
  SELECT DISTINCT po."id" FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
  WHERE po."status" = 'RECEIVED' AND COALESCE(poi."receivedQty",0) < COALESCE(poi."quantity",0)
);
```

#### Order — 200+ Orders with paymentStatus=PAID but no linked PAID Invoice.

- **Count:** 200
- **Sample:** `c4670871-a747-54aa-a339-e2ee0d729eed`, `16e041c7-c8b6-56a4-9485-b6135933b255`, `cmo6m0y2k07xn5uq8otu7mctv`, `cmo6m15cu081f5uq87fbk1208`, `cmo6m1r7g08ki5uq87eyxl2l2`
- **Impact:** Order marks itself as paid with no accounting evidence. Accounts may appear current that aren't.

```sql
-- Spot-check: SELECT "id","orderNumber","paymentStatus","total" FROM "Order" WHERE "paymentStatus" = 'PAID' LIMIT 50;
```

## P2 — Informational / minor

### B. Derived-field drift

#### Invoice — Invoice.total differs from linked Order.total by >$0.01 on 108+ rows.

- **Count:** 108
- **Sample:** `inv_mn7qzjar_1ot2pj`, `cmn229jdv00d4upbrhrbc53yz`, `inv_mn7qzsat_i9r98o`, `inv_mn7qzmq8_t64b19`, `inv_mn7qzizj_8zwc8d`
- **Impact:** Acceptable if invoice was partially invoiced or adjusted, but should be reviewed.

```sql
-- Manual review. Invoice may intentionally differ (change orders, partial invoicing). Spot-check:
-- SELECT i."id", i."total" AS inv, o."total" AS ord FROM "Invoice" i JOIN "Order" o ON o."id" = i."orderId" WHERE ABS(i."total" - o."total") > 0.01 LIMIT 50;
```

### C. Timestamp ordering

#### Job — Job.actualDate earlier than the linked Order.createdAt on 13+ rows.

- **Count:** 13
- **Sample:** `job_mn7qr2lm_pzbcyo`, `job_mn7qr1g7_uvcjvd`, `job_mn7qr3rn_u5zyvw`, `job_mn7qqizt_uctucz`, `job_mn7qzq41_2luj25`
- **Impact:** Impossible — job done before order created. Likely stale/imported date.

```sql
-- Investigate each row; may be a legacy import artifact. No auto-fix.
-- SELECT j."id", j."actualDate", o."createdAt" FROM "Job" j JOIN "Order" o ON o."id"=j."orderId" WHERE j."actualDate" < o."createdAt" LIMIT 50;
```

### G. Cross-table consistency

#### Order — 441 Orders have zero OrderItems.

- **Count:** 441
- **Sample:** `ord_if_83f711e11a33ac3a7995`, `ord_if_bf12efa1dade5426e645`, `cmo6m23zz08xf5uq8xg38c5kh`, `ord_if_7adf85db2e1ff57eb11f`, `ord_if_46d8f386bbb9036dac79`
- **Impact:** Could be forecast/placeholder orders, or broken imports. Review.

```sql
-- Investigate. For forecast/placeholder orders this may be legitimate.
-- SELECT "id","orderNumber","status","total","isForecast","createdAt" FROM "Order" WHERE "id" IN (SELECT o."id" FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id" WHERE oi."id" IS NULL) LIMIT 50;
```

#### PurchaseOrder — 37 PurchaseOrders with zero PurchaseOrderItems.

- **Count:** 37
- **Sample:** `a3ae3b83-c2e2-4aa3-a75c-f37af3f54d11`, `cmo7in6ka00t6n6vp220qooqs`, `cmo7ilhig0007n6vpfoy600d8`, `cmo7invp0019pn6vpqj77gr7i`, `e2e8fc86-abc6-4d9e-96a6-490f5f54070d`
- **Impact:** Empty PO shells; may be legacy seed or canceled drafts.

```sql
-- SELECT "id","poNumber","vendorId","status","source","createdAt" FROM "PurchaseOrder" WHERE "id" NOT IN (SELECT DISTINCT "purchaseOrderId" FROM "PurchaseOrderItem") LIMIT 50;
```

### H. Temporal coverage

#### PurchaseOrder — 69/3759 PurchaseOrders have orderedAt IS NULL.

- **Count:** 69
- **Impact:** AP aging & lead-time reporting miscount.

```sql
-- For non-draft POs, backfill from createdAt (see check E):
-- UPDATE "PurchaseOrder" SET "orderedAt" = "createdAt" WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED');
```

#### Order — Order.orderDate year distribution: 2024:786, 2025:2044, 2026:821

- **Count:** 3
- **Sample:** `2024:786, 2025:2044, 2026:821`
- **Impact:** Informational — verify there are no surprise gaps or outlier years.

### I. Status coherence

#### Order — 200+ Orders in DELIVERED state with no Delivery record via any linked Job.

- **Count:** 200
- **Sample:** `cmo6m306409ve5uq89xkagd40`, `cmo6lz63s06ln5uq8o1700xhs`, `cmo6me6gg0hxz5uq8geg48qh9`, `ord_if_165ae46f3a1843bf1db2`, `cmo6mfqr50imy5uq8zryzf1w0`
- **Impact:** Fulfilment audit trail is thin — we know it delivered but can't show when/where.

```sql
-- Spot-check. Not always a bug — some legacy orders predate Delivery tracking.
```

#### Job — 119 Jobs in COMPLETE/INVOICED/CLOSED state without a Delivery record.

- **Count:** 119
- **Sample:** `job_mnrneyqw_w3agpp`, `job_mnrng195_7i6cx1`, `job_mnrng18s_qtnjqw`, `job_mn7qz4wh_q6j814`, `job_mnrnkszv_blx93n`
- **Impact:** Completion tracked without fulfilment evidence. Legacy jobs may predate Delivery entity.

```sql
-- Spot-check: SELECT "id","jobNumber","builderName","status","createdAt" FROM "Job" WHERE "status" IN ('COMPLETE','INVOICED','CLOSED') AND "id" NOT IN (SELECT DISTINCT "jobId" FROM "Delivery") LIMIT 50;
```

### J. Table row counts

#### multi — Baseline counts (40 tables): Builder=180, Community=9, BuilderContact=0, Product=3081, BomEntry=7885, BuilderPricing=1821, Project=10, Quote=8, QuoteItem=73, Order=3651, OrderItem=21086, Staff=65, Job=1023, Delivery=211, Installation=0, PunchItem=0, Invoice=112, InvoiceItem=175, Payment=83, PurchaseOrder=3759, PurchaseOrderItem=8035, Vendor=79, VendorProduct=1052, InventoryItem=618, StockTransfer=0, StockTransferItem=0, CollectionAction=87, CollectionRule=20, DataQualityRule=0, DataQualityIssue=0, InboxItem=293, AIInvocation=0, AuditLog=6, CronRun=6365, WebhookEvent=0, FinancialSnapshot=1, Deal=2, DealActivity=1, OutreachSequence=0, OutreachEnrollment=0

- **Count:** 40
- **Sample:** `Builder=180`, `Community=9`, `BuilderContact=0`, `Product=3081`, `BomEntry=7885`
- **Impact:** Informational.

### K. Dead test data

#### Builder — 12 Builder rows look like test/E2E leftovers: Audit Test Builder 2026-04-23T02:20:20.646Z \| E2E Probe Builder \| Audit Test Builder 2026-04-23T02:17:46.031Z \| E2E Probe Builder \| E2E Probe Builder

- **Count:** 12
- **Sample:** `test-audit-moauto2u-builder`, `test-probe-moaw5r5w-b`, `test-audit-moauqcrz-builder`, `test-probe-moaw7x9r-b`, `test-probe-moaw68vn-b`
- **Impact:** Pollutes reporting and AR lists.

```sql
-- Manual cleanup (CASCADE off so reassign/delete dependents first):
-- SELECT "id","companyName","email" FROM "Builder" WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%' OR "companyName" ILIKE '%audit test%' OR "companyName" ILIKE '%test builder%';
-- Once clean: DELETE FROM "Builder" WHERE <above> AND "id" NOT IN (SELECT "builderId" FROM "Order") AND "id" NOT IN (SELECT "builderId" FROM "Invoice");
```

#### Order — 5 Order rows look like E2E leftovers (sample orderNumbers: ORD-2026-39EI, ORD-2026-4OMC, ORD-2026-63F6, ORD-2026-QCRZ, ORD-2026-TO2U)

- **Count:** 5
- **Sample:** `test-audit-moau39ei-order`, `test-audit-moau4omc-order`, `test-audit-moau63f6-order`, `test-audit-moauqcrz-order`, `test-audit-moauto2u-order`
- **Impact:** Inflates sales totals.

```sql
-- Inspect and delete after confirming no FK dependents.
```

---

**One-line summary:** P0: 2 · P1: 13 · P2: 11 · Total rows scanned: 13431 · Duration: 21.7s
