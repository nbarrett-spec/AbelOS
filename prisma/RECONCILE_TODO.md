# Schema Drift — Tables in DB but not in `schema.prisma`

Generated: 2026-04-22 as part of P1 audit remediation (#23).

**How this list was built.** Extracted every `CREATE TABLE "..."` from the
codebase (`prisma/migrations/`, raw SQL inside `src/lib/` and `src/app/`),
diffed against the 84 `model` declarations in `prisma/schema.prisma`. Result:
**115 tables** exist at runtime but have no corresponding Prisma model.

This is a planning document, not a migration. **No schema changes are being
applied here** — the purpose is to classify every drifted table so a future
pass can decide whether to model, drop, or leave as raw-SQL-only.

## Classification legend

| Tag | Meaning |
|---|---|
| **RAW-SQL** | Intentionally raw-SQL-only. Low-churn append-only telemetry / staging / cache. Not worth modeling in Prisma. |
| **MODEL** | Should be added to `schema.prisma` — real business domain, queries appear in app code, benefits from type safety. |
| **STAGING** | Temporary import-landing table (Bolt/Bpw/Hyphen). Keep raw — feeds into mapped domain models. |
| **LEGACY** | Created by an old feature that was shipped behind a flag or never finished. Candidate for drop after verification. |
| **UNKNOWN** | Needs human review before classifying. |

---

## Telemetry / observability — keep RAW-SQL

These are append-only, high-volume, ephemeral. Modeling them in Prisma buys
nothing and makes schema noisy.

- `AuditLog` — RAW-SQL (already ensured via `ensureAuditTable` in `src/lib/audit.ts`)
- `AlertIncident`, `AlertMute` — RAW-SQL (observability alert pipeline)
- `ClientError`, `ServerError` — RAW-SQL (Sentry shadow — see `src/lib/observability.ts`)
- `SecurityEvent` — RAW-SQL (auth + WAF events)
- `SlowQueryLog` — RAW-SQL (pg slow query recorder)
- `UptimeProbe` — RAW-SQL (uptime-probe cron output)
- `EmailQueue` — RAW-SQL (outbound email queue, consumer trims rows)
- `EngineSnapshot` — RAW-SQL (NUC engine state snapshot)
- `AutomationLog` — RAW-SQL (audit trail for automation runs)

## Import-landing tables — keep STAGING

Created by Bolt / BPW / Hyphen importers. These are write-once-from-source,
mapped into domain models on read. Never reference them from TypeScript — all
access goes through the import scripts.

- `BoltCommunity`, `BoltCrew`, `BoltFloorplan`, `BoltWOType`, `BoltWorkOrder` — STAGING (Bolt ERP)
- `BpwCheck`, `BpwCommunity`, `BpwFieldPO`, `BpwInvoice`, `BpwJobDetail`, `BpwStagingData` — STAGING (BPW)
- `HyphenAccessToken`, `HyphenBuilderAlias`, `HyphenCredential`, `HyphenOrder`, `HyphenOrderEvent`, `HyphenPayment`, `HyphenProductAlias` — STAGING (Hyphen BuildPro/SupplyPro)

## Agent / Automation — MODEL (real domain)

These show up in ops code as business entities. Worth adding to Prisma for
type safety + migrations.

- `AgentTask` — MODEL (referenced by `/api/ops/my-day` and agent UI)
- `AgentSession`, `AgentConversation`, `AgentMessage` — MODEL (NUC worker trace)
- `AgentWorkflow`, `AgentEmailLog`, `AgentSmsLog` — MODEL (automation output)
- `AutomationRule`, `AutoPurchaseOrder` — MODEL (Phase 1 auto-reorder)

## Warranty — MODEL (was missed when warranty shipped)

Warranty surface is live but models weren't added. A prior audit stubbed
`WarrantyClaim` handling without DB, then SQL got applied later.

- `WarrantyClaim`, `WarrantyInspection`, `WarrantyPolicy`, `WarrantyTracker` — MODEL

## Inspections / QC — MODEL (dual-store today)

`QualityCheck` is in Prisma; `Inspection` is raw SQL. advance-job treats
both as authoritative. Unify: either add `Inspection` as a model, or
retire it and backfill into `QualityCheck`.

- `Inspection`, `InspectionTemplate` — MODEL (or retire)
- `PunchItem` — MODEL (punch list feature)

## Pricing engine — MODEL (real domain, multi-route)

- `PricingRule`, `PricingTier`, `PricingTierRule`, `DynamicPriceRule` — MODEL
- `PricingEvent` — RAW-SQL OK (pricing audit log)
- `CompetitorPrice`, `CostTrendAnalysis` — MODEL
- `SubcontractorPricing` — MODEL

## Inventory / Purchasing — MODEL

- `InventoryAllocation` — MODEL (referenced by generate-picks, MRP allocate/release)
- `ProductCategory` — MODEL (referenced by `/api/ops/product-categories`)
- `Supplier`, `SupplierProduct`, `SupplierPriceUpdate` — MODEL
  - NOTE: there is already a `Vendor` model. Decide: merge Supplier→Vendor or
    document why both exist.
- `MaterialLeadTime` — MODEL
- `ReorderSuggestion`, `SmartPORecommendation` — MODEL (Phase 1 auto-reorder)
- `VendorPerformance`, `VendorPerformanceLog`, `VendorScorecard` — MODEL
- `VendorReturn`, `VendorReturnItem` — MODEL
- `ProcurementAlert` — MODEL

## Warehouse / Delivery — MODEL

- `WarehouseBay`, `BayMovement` — MODEL (bay tracking)
- `DoorEvent`, `DoorIdentity` — MODEL (dock-door scanner)
- `DeliveryFeedback` — MODEL (post-delivery survey)
- `Location` — MODEL (physical warehouse locations)

## Sales / Marketing — MODEL

- `Deal`, `DealActivity` — already MODEL ✓
- `Prospect`, `PermitLead` — MODEL (lead sourcing)
- `MarketingCampaign`, `CampaignRecipient` — MODEL
- `OutreachActivity` — MODEL (outreach engagement log)
- `RetentionAction`, `UpsellRecommendation` — MODEL
- `SEOContent`, `SEOKeyword` — MODEL (content marketing)
- `InstantQuoteRequest`, `QuoteRequest` — MODEL
- `QuoteOptimizationLog`, `ProfitOptimizationLog` — RAW-SQL OK
- `SavedCart` — MODEL (builder portal)

## Builder CRM — MODEL

- `BuilderCatalog`, `BuilderIntelligence`, `BuilderMessage`,
  `BuilderNotification`, `BuilderNotificationPrefs`,
  `BuilderScheduleShare`, `BuilderValueProfile` — MODEL

## Finance — MODEL

- `CashFlowForecast`, `CreditLineTracker`, `WorkingCapitalSnapshot`,
  `InvoiceTimingRule`, `PaymentOptimization`, `PaymentTermRecommendation`,
  `RevenueForecast` — MODEL
- `LienRelease` — MODEL (page at `/ops/lien-releases`)

## Scheduling / Change Orders — MODEL

- `ChangeOrder` — MODEL
- `ScheduleChangeRequest`, `ScheduleMilestone` — MODEL

## Ops / Other — MODEL

- `DocumentVault`, `DocumentVaultActivity` — MODEL
- `MessageReadReceipt` — MODEL
- `ServiceRequest` — MODEL
- `Trade`, `TradeReview` — MODEL (trade-finder feature)
- `DemandForecast`, `QualityPrediction` — MODEL
- `SystemSetting` — MODEL

## Miscellaneous — UNKNOWN, needs review

- `StaffRoles` — UNKNOWN. Sounds like a many-to-many of Staff↔Role. Probably
  supersedes the comma-separated `Staff.roles` string. Investigate and merge.

---

## Suggested next pass (separate ticket, not this audit)

1. Add all **MODEL**-tagged tables to `schema.prisma`, one module at a time
   (warranty, pricing, inventory, etc.). Run `prisma db pull` first to get
   accurate column shapes.
2. Document **STAGING** and **RAW-SQL** tables at the top of `schema.prisma`
   as a block comment so new devs know why they're missing.
3. Investigate **UNKNOWN** entries and reclassify.
4. For Supplier/Vendor duplication — decide and consolidate.
5. Retire `Inspection` raw table if `QualityCheck` can absorb its rows.
