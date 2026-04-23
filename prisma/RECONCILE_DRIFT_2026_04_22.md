# Schema Drift — DB vs `prisma/schema.prisma`

Generated: 2026-04-22 by schema-vs-DB reconciliation pass.

**Goal of this doc:** catalogue every shape mismatch between the live Neon
production DB and `prisma/schema.prisma` so a follow-up pass can decide whether
to update the schema (safe) or the DB (requires migration).

**Not fixed here** — per the reconciliation rules, existing models in
`schema.prisma` are NOT edited in this pass because column-level changes can
break runtime code that depends on current Prisma types. Every item below is
a flag for a separate, targeted change later.

## Baseline

- **218 tables** in live DB (`pg_tables` where schemaname='public').
- **218 models** in `prisma/schema.prisma`.
- **No table-level drift** — every DB table has a Prisma model and vice versa.
  (The 115-table gap from `RECONCILE_TODO.md` has already been closed in a
  prior pass.)
- **63 enums** in DB, **60 enums** in schema.

## Pre-existing schema validation errors (NOT caused by this pass)

`npx prisma validate` on the current main fails with:

```
Error parsing attribute "@id": The given constraint name `Community_pkey` has
to be unique in the following namespace: global for primary key, indexes and
unique constraints.
  -->  prisma/schema.prisma:109   model Community
  -->  prisma/schema.prisma:3970  model Community_legacy   @id(map: "Community_pkey")
```

Both models declare the same PK constraint name `Community_pkey`. Fix is to
rename the legacy map (e.g. `map: "Community_legacy_pkey"`) but that touches an
existing model so it's out of scope for this pass.

## Enum drift

### Enums in DB but not in schema (4) — LEGACY, DO NOT DROP

Classification pass 2026-04-22 (enum-reconcile task): all four verified as
orphan Postgres enum types — no column in the live DB uses any of them.
Confirmed against `scripts/db_introspect_2026_04_22.json`:
`DoorIdentity.status`, `DoorEvent.eventType`, `SyncLog.direction`, and
`SyncLog.status` are all `data_type=text` / `udt_name=text`.

**Decision: LEGACY. Keep the enum types in DB, do not wire into the schema.**

Rationale for each:

| Enum | Values | Origin | Why LEGACY |
|---|---|---|---|
| `DoorEventType` | CREATED, QC_PASS, QC_FAIL, NFC_LINKED, STORED, STAGED, LOADED, DELIVERED, INSTALLED, WARRANTY_CLAIMED, WARRANTY_RESOLVED, RETURNED, NOTE | Created by `POST /api/ops/migrate/manufacturing-tables` (see `src/app/api/ops/migrate/manufacturing-tables/route.ts` line 49) as part of the door / NFC tag-program feature | Manufacturing migration DDL declared `DoorEvent.eventType` as this enum type, but the column in prod is `text`. Feature is drafted (DoorEvent/DoorIdentity tables exist, routes at `src/app/api/door/[id]/route.ts` and `src/app/api/ops/manufacturing/tag-program/route.ts` read/write using string comparisons) but never completed the enum promotion. Promoting the column now would require coordinated migration + refactor of every raw-SQL writer. Out of scope for this pass. |
| `DoorStatus` | PRODUCTION, QC_PASSED, QC_FAILED, STORED, STAGED, LOADED, DELIVERED, INSTALLED, WARRANTY_CLAIM, RETURNED | Same origin — `manufacturing-tables` migration route line 37 | Same analysis. `DoorIdentity.status` is `text DEFAULT 'PRODUCTION'`. Active code paths (`tag-program/route.ts`) use `status::text = 'PRODUCTION'` comparisons — they already treat the column as text. |
| `SyncDirection` | PULL, PUSH, BIDIRECTIONAL | Early sync-logging design; created before `SyncLog` was finalized with `direction String @default("PUSH")` | `SyncLog.direction` is `text`. The only cast-to-enum call site is `src/lib/integrations/gmail.ts` line 307 (`$1::"SyncDirection"`), which serves as a parameter-validation trick — pg validates the value is a valid enum label, then text-coerces into the text column. Functional but not using the type as a column type. |
| `SyncStatus` | SUCCESS, PARTIAL, FAILED | Same origin as `SyncDirection` | Same analysis. `SyncLog.status` is `text`. Same gmail.ts call site casts to `"SyncStatus"` for validation then text-coerces. |

**Follow-up (deferred):** if Door NFC program is revived, promote
`DoorIdentity.status` + `DoorEvent.eventType` to typed enum columns in one
migration and refactor the raw-SQL writers in `src/app/api/door/**` +
`src/app/api/ops/manufacturing/tag-program/route.ts`. Same for `SyncLog` if
sync-log analytics ever need type-safe filtering. Until then, the enum types
stay in the DB as dormant vocabulary registries — they don't cost anything
and preserve the intended label set for when it matters.

### Enums in schema but not in DB (1)

| Enum | Notes |
|---|---|
| `POCategory` | Declared in schema and referenced by `PurchaseOrder.category`, but **neither the enum type nor the `category` column exists in the DB**. At runtime any Prisma create/update touching `category` will fail. Two options: (a) ship a migration that creates the `POCategory` enum and adds `PurchaseOrder.category POCategory DEFAULT 'GENERAL'`, or (b) remove `category` from the model. **Flag as P0.** |

## Column-level drift

Summary counts:

| Kind | Count |
|---|---|
| Schema has field, DB missing column (phantom fields) | **14** |
| DB has column, schema missing field | **160** |
| Nullability mismatch | **48** |
| Type mismatch (scalar vs udt) | **0** |

### Phantom fields — schema declares but DB lacks (14)

These trigger runtime errors the first time Prisma tries to read/write the
column. All are P0 candidates.

| Model.field | Declared type | Recommendation |
|---|---|---|
| `Project.latitude` | `Float?` | Migration: `ALTER TABLE "Project" ADD COLUMN "latitude" float8`, OR drop from schema |
| `Project.longitude` | `Float?` | Migration or drop |
| `OrderTemplateItem.createdAt` | `DateTime` | Migration: add column with default `now()` |
| `PurchaseOrder.category` | `POCategory` | See enum drift above. **P0** — in use. |
| `Message.builderSenderId` | `String?` | Migration: add column |
| `Message.senderType` | `String` | Migration: add column with a safe default |
| `Message.readByBuilder` | `Boolean` | Migration: add column with default `false` |
| `Conversation.builderId` | `String?` | Migration: add column |
| `Conversation.subject` | `String?` | Migration: add column |
| `Conversation.lastMessagePreview` | `String?` | Migration: add column |
| `BTProjectMapping.btBlock` | `String?` | Migration: add column |
| `CollectionRule.updatedAt` | `DateTime` | Migration: add column with default `now()` |
| `CronRun.cronName` | `String` | Likely replaced by `CronRun.name`. Rename one side. |
| `CronRun.endedAt` | `DateTime?` | Likely replaced by `CronRun.finishedAt`. Rename one side. |

### Missing fields — DB has columns the schema never modeled (160)

These columns were added via migration (or `prisma db execute`) without the
schema being updated. The app CAN still insert/update rows today — Prisma just
doesn't know about them, so they're invisible to type-safe queries. Low
immediate risk, but adds up. Recommend one PR per module to add them.

**Models with the most drift** (top 10):

| Model | Missing columns | Sample |
|---|---:|---|
| Builder | 18 | `organizationId`, `role`, `source`, `divisionId`, `pricingTier`, notification prefs, QB fields |
| Vendor | 13 | credit fields, payment terms, risk score |
| Quote | 10 | signature / rejection / AI recommendation fields |
| Contract | 10 | `organizationId`, lifecycle + rebate fields |
| Product | 9 | `laborCost`, `overheadCost`, `supplierId`, dimensions |
| Job | 8 | Hyphen IDs, QC flags, `divisionId`, `locationId` |
| PurchaseOrder | 8 | QB fields, AI generation metadata |
| Invoice | 8 | QB + Stripe payment-link fields |
| Staff | 7 | payroll cost fields (`annualSalary`, `burdenRate`, etc.) |
| SyncLog | 7 | `integration`, `entity`, `entityId`, `details`, etc. |

**Full model list with drift** (33 models total):

AutomationRule, Builder, BuilderCatalog, CollectionAction, CommunicationLog,
Contract, Crew, CronRun, Delivery, DocumentVault, Installation,
IntegrationConfig, InventoryItem, Invoice, Job, MaterialPick, Message, Order,
Payment, Product, PunchItem, PurchaseOrder, PurchaseOrderItem, QualityCheck,
Quote, ScheduleMilestone, Staff, Supplier, SyncLog, Takeoff, Task, Trade,
Vendor.

See `_rec_tmp/drift_report.json` for the full per-field breakdown (this file
is in `.gitignore`-eligible temp space; the JSON is not committed).

### Nullability drift (48)

Two flavors, both flagged but with different severity:

**High risk** — DB is NOT NULL but Prisma declares the field optional. Inserts
that rely on the optional declaration can fail:

| Model.field |
|---|
| `Takeoff.blueprintId` |
| `Message.senderId` |
| `Conversation.createdById` |
| `Contract.paymentTerm` |
| `Contract.discountPercent` |
| `IntegrationConfig.name` |

**Low risk** — DB is nullable but Prisma declares required-with-default. Prisma
fills the default at insert, so runtime works. Still worth aligning:

> 42 items covering `Builder.builderType`, most `createdAt`/`updatedAt` on
> Community*, BuilderContact*, CommunityFloorPlan, CommunityNote,
> CrewMember, AccountReviewTrigger, AccountTouchpoint,
> OutreachSequence/Step/Enrollment/Template, and `Contract.type`,
> `CronRun.triggeredBy`, `OutreachSequence.active/stepCount`, etc.

See `_rec_tmp/drift_report.json` for the complete list.

## Action checklist (for a follow-up PR, not this pass)

1. **Fix `Community` / `Community_legacy` PK collision** so `prisma validate`
   passes again (rename `Community_legacy_pkey`).
2. **Resolve `POCategory`** — decide enum-in-DB-plus-column, or drop from
   schema.
3. **Address 6 high-risk nullability mismatches** (NOT NULL in DB, optional in
   Prisma) — either relax DB or tighten Prisma.
4. **Add drifted columns to schema**, one module at a time (Builder, Vendor,
   Contract, Quote, Product, Job, PurchaseOrder, Invoice, Staff, SyncLog first
   — those are the biggest concentrations).
5. **Resolve `CronRun.cronName` vs `CronRun.name`** and
   `CronRun.endedAt` vs `CronRun.finishedAt` naming conflicts.
6. ~~**Drop or adopt the 4 orphan enums** (`DoorEventType`, `DoorStatus`,
   `SyncDirection`, `SyncStatus`).~~ **RESOLVED 2026-04-22** — all four
   classified as LEGACY (see Enum drift section above). Do not drop, do not
   wire. Revisit only if the owning feature (door NFC program or type-safe
   sync-log analytics) is activated.
