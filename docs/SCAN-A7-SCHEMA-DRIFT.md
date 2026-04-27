# SCAN-A7: Schema Drift — `prisma/schema.prisma` vs Neon prod

- **HEAD:** `171a6b4`
- **Probe:** `scripts/_tmp-schema-drift.mjs` (read-only, deleted after run)
- **Run timestamp:** 2026-04-27
- **Artifact:** `scripts/_schema_drift.json` (full machine-readable diff)
- **Method:** parsed `schema.prisma` (221 models, 61 enums) and queried Neon `information_schema` + `pg_*` catalogs.

## Topline

| Bucket                                     | Count |
|--------------------------------------------|-------|
| Models in schema                           | 221   |
| Enums in schema                            | 61    |
| Tables on prod (`public`)                  | 247   |
| Enums on prod                              | 65    |
| Tables in schema, **missing on prod**      | **0** |
| Tables on prod, **not in schema**          | **26**|
| Models with column drift                   | 49    |
| Enums with drift                           | 14    |
| `@@index` declarations not found on prod   | 228 (noisy, see below) |

Migrations were hand-applied via `scripts/_apply-*.mjs` rather than `prisma migrate deploy`, so drift is real. Encouraging: every schema model has a matching prod table — the bigger problem is **prod has things schema doesn't see**.

---

## Tables missing on prod (count: 0)

None. Every `model X` in `schema.prisma` has a corresponding `"X"` table in `public`. The prior-audit hint about `ProductCategory` and `Supplier` being missing is **stale** — both exist on both sides; only `Supplier.categories` is an extra-on-prod column.

---

## Tables on prod, not in schema (count: 26)

Prisma is blind to all of these. Most are accessed via raw SQL from `src/`. Row counts confirm which are live vs vestigial.

**Live tables that should be added to schema:**

| Table                       | Rows   | Primary user                                              |
|-----------------------------|-------:|-----------------------------------------------------------|
| `ProductSubstitution`       | 20,804 | `src/app/api/ops/substitutions/**`, `src/app/api/ops/products/[productId]/substitutes/**` |
| `ManufacturingStep`         |  1,829 | `src/lib/allocation/allocate.ts`, warehouse daily plan    |
| `GoldStockKitComponent`     |    991 | `cron/gold-stock-monitor`, `ops/gold-stock/**`            |
| `BrookfieldPlanBom`         |    793 | `ops/communities/[id]/floor-plans/[planId]/bom`           |
| `EmailSendLog`              |    278 | `src/lib/digest-email.ts` (cron digest idempotency)       |
| `BloomfieldPlanBom`         |    215 | floor-plan BoM endpoint                                   |
| `VendorScorecardSnapshot`   |    108 | `cron/vendor-scorecard-daily`                             |
| `TollBrothersPlanBom`       |     76 | floor-plan BoM endpoint                                   |
| `ProductImage`              |     59 | `src/lib/product-images.ts`, `ops/products` page          |
| `CycleCountLine`            |     40 | `ops/warehouse/cycle-count/**`                            |
| `BrookfieldVeAlternative`   |     35 | BWP value-engineering workstream                          |
| `GoldStockKit`              |     14 | `ops/gold-stock/**`                                       |
| `CalendarEvent`             |      9 | `ops/calendar/jobs`, `app/ops/calendar/**`                |
| `Sop`                       |      8 | `api/ops/sops/route.ts`                                   |
| `VendorNote`                |      8 | vendor-detail UI                                          |
| `LegalNote`                 |      6 | MG Financial workstream                                   |
| `CycleCountBatch`           |      2 | warehouse cycle-count endpoints                           |
| `HyphenCommunityMapping`    |      2 | `src/lib/hyphen/correlate.ts`                             |
| `HyphenCommunityAlias`      |      2 | (above)                                                   |
| `SyncCursor`                |      1 | `cron/inflow-sync`                                        |

**Maybe-archive / decide:**

| Table                       | Rows | Notes                                                         |
|-----------------------------|-----:|---------------------------------------------------------------|
| `BoltWorkOrderLink`         |  726 | Legacy ECI Bolt bridge; keep until Bolt cutover, then drop    |
| `PulteHistoricalBackcharge` |   85 | Pulte account lost 2026-04-20 — archive or add for analytics |
| `ArHistorySnapshot`         |   24 | AR analytics; no obvious code reference                        |
| `BankEntry`                 |    3 | Banking module unclear                                         |
| `GoldStockInstance`         |    0 | Pair with kit/component if added                               |
| `ProductGroup`              |    0 | Planned grouping; add or drop                                  |

**Severity:** silent-data risk. No 500s, but `Prisma.findMany` with `include` cannot reach these and triggers fallback raw SQL throughout `src/`.

---

## Column drift (P0 — schema declares column prod lacks)

These will 500 on writes that include the column. Confirmed by re-querying `information_schema`.

### model `OrderTemplateItem`
- Field `createdAt` (DateTime, required) — **MISSING on prod**.
- `src/app/api/builder/templates/route.ts:150` does `INSERT INTO "OrderTemplateItem" (..., "createdAt") VALUES ...` — **this INSERT 500s on every call** (`column "createdAt" does not exist`).
- **Fix:** `ALTER TABLE "OrderTemplateItem" ADD COLUMN "createdAt" timestamp(3) NOT NULL DEFAULT now();`

### model `BTProjectMapping`
- Field `btBlock` (String, optional) — **MISSING on prod**.
- Referenced by name in `src/lib/integrations/buildertrend.ts` and `cron/buildertrend-sync`. Whether it 500s depends on whether code does Prisma `select`/`set` with `btBlock`.
- **Fix:** `ALTER TABLE "BTProjectMapping" ADD COLUMN "btBlock" text;`

### model `CollectionRule`
- Field `updatedAt` (DateTime, required) — **MISSING on prod**.
- `seed-demo-data/route.ts:616` writes the column on insert; collection cycle reads via Prisma. Required-non-optional schema field absent on prod → Prisma `findMany`/`update` will throw.
- **Fix:** `ALTER TABLE "CollectionRule" ADD COLUMN "updatedAt" timestamp(3) NOT NULL DEFAULT now();`

---

## Column drift (P1 — extra columns on prod, schema-blind)

Prisma will not project these in `findMany` results. Verified row counts:

| Table             | Column(s)                                                                 | Populated   | Severity |
|-------------------|---------------------------------------------------------------------------|-------------|----------|
| `PurchaseOrderItem` | `crossDockFlag`, `crossDockJobIds`, `crossDockCheckedAt`, `jobId`        | 8146/8146 (flag) | **P1** — entire cross-dock pipeline schema-blind |
| `Job`             | `jobAddressRaw`                                                            | 996/3999    | **P1** — legacy address blob, UI can't see it |
| `CollectionAction` | `requiresApproval`, `approvedAt`, `approvedBy`, `toneUsed`, `intelligenceSnapshot` | 131/131 | **P1** — approval gate schema-blind |
| `Crew`            | `isSubcontractor`, `companyName`, `contactPhone`, `contactEmail`           | 24/24       | **P1** — migration-v10 subcontractor data |
| `Builder`         | `salesOwnerId`                                                              | 14/170      | P2       |
| `Community`       | `latitude`, `longitude`                                                     | 10/12       | P2       |
| `Supplier`        | `categories` (text[])                                                       | 9/9         | **P1** — vendor categorization |
| `FinancialSnapshot` | `cogs`, `grossProfit`, `operatingExpenses`, `netIncome`, `liabilities`, `notes` | 6/6   | **P1** — full P&L row schema-blind |
| `Payment`         | `status`                                                                    | 4602/4602   | **P1** — payment status schema-blind |
| `Payment`         | `builderId`, `referenceNumber`, `processedById`, `processedAt`, `createdAt`| 0/4602      | P3       |
| `Order`           | `qbTxnId`, `qbSyncedAt`, `legacySource`, `legacyDescription`, `driverId`, `deliveryConfirmedAt`, `deliverySignature`, `trackingUpdates` | 0/4574 each | P2 — empty placeholders |
| `Job`             | `materialConfirmedAt`, `materialConfirmedBy`, `materialConfirmNote`, `materialEscalatedAt`, `materialEscalatedTo`, `orderIdMatchMethod` | 0/3999 | P2 — empty |
| `Delivery`        | `curriBookingId`, `curriTrackingUrl`, `curriCost`                          | 0/204       | P2 — Curri not wired |
| `MaterialPick`    | `pickedById`, `verifiedById`, `orderItemId`, `bomEntryId`, `parentProductId`, `allocationId` | 0/0 | P3 |
| `Message`         | `threadId`, `mentions`, `reactions`, `isEdited`, `editedAt`                | 0/0         | P3       |
| `IntegrationConfig` | `gmailWatchExpiry`, `gmailHistoryId`, `lastSyncError`, `configuredById`  | 0/4         | P2       |
| `BuilderPricing`  | `revisionTag`, `effectiveDate`                                              | unchecked   | P2       |
| `OrderItem`       | `legacyLineId`                                                              | unchecked   | P2       |
| `SyncLog`         | `errorDetails`, `integration`, `entity`, `entityId`, `details`, `error`, `syncedAt` | unchecked | P2 |
| `QualityCheck`    | `materialPickId`                                                            | unchecked   | P3       |
| `InventoryItem`   | `minStockLevel`                                                             | unchecked   | P2       |
| `Task`            | `dealId`, `createdById`                                                     | unchecked   | P2       |
| `ScheduleMilestone` | `dependsOn`                                                               | unchecked   | P3       |
| `Takeoff`         | `floorPlanId`                                                               | 0/1         | P3       |

**Two highest-impact P1 silent-data items:** `Job.jobAddressRaw` (996 rows the UI can't see via Prisma) and `PurchaseOrderItem.crossDockFlag` (entire 8146-row table tagged but invisible to ORM).

---

## Nullability mismatches (P2 — correctness, not crashes)

59 columns where schema declares non-optional but prod allows NULL. These are concentrated in tables where migrations did `ALTER TABLE ... ADD COLUMN` without a `NOT NULL` clause, then schema was tightened. Top offenders:

- `Community`: `totalLots`, `activeLots`, `status`, `createdAt`, `updatedAt`
- `BuilderContact`: `role`, `isPrimary`, `receivesPO`, `receivesInvoice`, `active`
- `OutreachSequence` / `OutreachEnrollment` / `OutreachStep` / `OutreachTemplate`: most fields
- `CommunityNote`: `category`, `pinned`, `createdAt`, `updatedAt`
- `BTProjectMapping`: `btProjectName`, `btStatus`
- `Delivery`/`QualityCheck`/`Installation` photo arrays: `loadPhotos`, `defectCodes`, `beforePhotos`, etc.

Risk: Prisma deserialization throws when a NULL appears in a non-optional field. Spot-checking is needed; no failure was triggered in this scan. Full list in `_schema_drift.json`. **Fix shape:** `UPDATE "X" SET "col"=<default> WHERE "col" IS NULL;` then `ALTER TABLE "X" ALTER COLUMN "col" SET NOT NULL;` — or relax the schema to `?`.

---

## Enum drift

All 61 schema enums exist on prod. The drift is in **values**.

### Schema enums where prod has values not declared (P0/P1)

| Enum                | Prod-only values                                                          | Spot-check                                                                | Severity |
|---------------------|---------------------------------------------------------------------------|---------------------------------------------------------------------------|----------|
| `BuilderRole`       | `SUPERINTENDENT`, `PURCHASING`, `PROJECT_MANAGER`, `ESTIMATOR`, `OTHER`   | **146 live rows on prod** (`OTHER`=142, `PURCHASING`=3, `SUPERINTENDENT`=1, `PROJECT_MANAGER`=1). `BuilderContact.role` Prisma reads currently throw on these rows. | **P0** |
| `IntegrationProvider` | `BOISE_CASCADE`                                                          | 1 live row uses `BOISE_CASCADE`. Prisma read of that row fails.            | **P0** |
| `CategoryType`      | `ADD_ON`                                                                   | unchecked — likely live                                                    | P1 |
| `IntegrationStatus` | `DISABLED`                                                                 | unchecked                                                                  | P1 |
| `LeadSource`        | `AI_TAKEOFF`, `WEBSITE`, `COLD_CALL`, `HYPHEN`, `EXISTING`                | `Lead` table doesn't exist (verified) — drift but no current impact        | P2 |
| `DealSource`        | `WEBSITE`, `EXISTING_CUSTOMER`                                            | Deal data shows `OUTBOUND`, `INBOUND`, `REFERRAL` only — no current impact | P2 |
| `ContractStatus`    | `PENDING_REVIEW`, `RENEWED`                                               | Contract data is only `ACTIVE`; `Contract.status` is actually `String` not enum in schema | P3 |
| `PaymentTerm`       | `DUE_ON_RECEIPT`                                                           | `Order.paymentTerm` shows only `NET_15`, `NET_30`, `PAY_ON_DELIVERY` — no current impact | P2 |

### Schema enums with values not yet on prod (schema is ahead — P3)

- `OrderStatus`: schema has `AWAITING_MATERIAL`, `PARTIAL_SHIPPED` not in prod enum
- `NotificationType`: schema has `MATERIAL_ARRIVAL`, `BACKORDER_UPDATE`, `OUTREACH_REVIEW` not in prod
- `ContractStatus`: schema has `INTERNAL_REVIEW`, `SENT`, `BUILDER_REVIEW`, `REVISION_REQUESTED`, `SIGNED` not in prod
- `BuilderRole`: schema has `SECONDARY`, `CONTRACTOR` not in prod
- `LeadSource`: schema has `INBOUND`, `OUTBOUND` not in prod

### Prod enums with no schema definition (P1)

- `DoorEventType`, `DoorStatus`, `SyncDirection`, `SyncStatus`

These exist on prod (likely from `migration-v11`) but are not in `schema.prisma`. Code using them via raw SQL works; Prisma cannot map them.

**Highest priority enum fixes:** add `PURCHASING`, `SUPERINTENDENT`, `PROJECT_MANAGER`, `ESTIMATOR`, `OTHER` to schema `BuilderRole` (146 broken rows). Add `BOISE_CASCADE` to `IntegrationProvider`. Add `ADD_ON` to `CategoryType`.

---

## Index drift (P2 — perf only, noisy)

228 `@@index([...])` declarations have no matching index detected. The number is **inflated** because the probe matches on quoted column names in `pg_indexes.indexdef` and misses indexes named differently or implicit `UNIQUE`/PK indexes.

Concentration suggests recent `@@index` directives in schema were never applied:
- `MaterialWatch`, `AuditLog` — 6 missing each
- `InboxItem` — 5
- `Staff`, `PurchaseOrder`, `InventoryItem`, `IntegrationConfig`, `AgentTask`, `ProfitOptimizationLog`, `SupplierPriceUpdate` — 4 each
- Singletons across `Builder.email`, `Community.status`, `Community.city,state`, `BuilderContact.email`, `Order.status`, `Product.sku`

**Recommendation:** before treating as truth, run `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` and compare the resulting `CREATE INDEX` statements to `pg_indexes` directly — half of the gap will be naming-mismatch noise.

---

## Default-value drift

Not exhaustively scanned in this pass. Several `createdAt`/`updatedAt` columns in the nullability-mismatch list show schema declares `@default(now())` but prod allows NULL — strong signal those were `ALTER TABLE ADD COLUMN`-ed without a default and are NULL for early rows. Flagged as a follow-up scan.

---

## Top-priority remediation list

| # | Sev | Action |
|---|-----|--------|
| 1 | **P0** | `ALTER TABLE "OrderTemplateItem" ADD COLUMN "createdAt" timestamp(3) NOT NULL DEFAULT now();` — INSERT route already broken |
| 2 | **P0** | `ALTER TABLE "CollectionRule" ADD COLUMN "updatedAt" timestamp(3) NOT NULL DEFAULT now();` — Prisma reads broken |
| 3 | **P0** | Extend `BuilderRole` enum: add `PURCHASING`, `SUPERINTENDENT`, `PROJECT_MANAGER`, `ESTIMATOR`, `OTHER` — 146 rows currently un-readable via Prisma |
| 4 | **P0** | Extend `IntegrationProvider`: add `BOISE_CASCADE` — 1 row un-readable |
| 5 | P1 | `ALTER TABLE "BTProjectMapping" ADD COLUMN "btBlock" text;` |
| 6 | P1 | Add to schema: `ProductSubstitution`, `ManufacturingStep`, `EmailSendLog`, `BrookfieldPlanBom`, `BloomfieldPlanBom`, `TollBrothersPlanBom`, `VendorScorecardSnapshot`, `ProductImage`, `CalendarEvent`, `Sop`, `HyphenCommunityMapping`, `HyphenCommunityAlias`, `GoldStockKit*`, `CycleCountBatch`, `CycleCountLine`, `SyncCursor`, `LegalNote`, `VendorNote`, `BrookfieldVeAlternative` |
| 7 | P1 | Promote schema-blind columns currently holding live data: `Job.jobAddressRaw` (996), `PurchaseOrderItem.crossDockFlag` family (8146), `Crew.isSubcontractor` family (24), `Supplier.categories` (9), `CollectionAction.requiresApproval` family (131), `FinancialSnapshot` P&L fields (6), `Payment.status` (4602) |
| 8 | P1 | Extend enums to match prod: `CategoryType` (`ADD_ON`), `IntegrationStatus` (`DISABLED`); plan ahead for `LeadSource`, `DealSource`, `PaymentTerm` |
| 9 | P1 | Add `DoorEventType`, `DoorStatus`, `SyncDirection`, `SyncStatus` enums to schema |
| 10 | P2 | Backfill NULLs on the 59 nullability-mismatch columns and add `NOT NULL` (or relax schema to `?`) |
| 11 | P2 | Run `prisma migrate diff` and reconcile `@@index` declarations after first cleaning up the noise |
