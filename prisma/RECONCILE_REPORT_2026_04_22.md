# Schema Reconciliation Report — 2026-04-22

**Scope:** Catalog every table in the live Neon production DB, compare to
`prisma/schema.prisma`, classify, and promote high-value tables to Prisma
models if they weren't already.

**Constraint:** Touch only `prisma/schema.prisma` and `prisma/RECONCILE_*.md`.

## Method

1. Introspected `pg_tables` (schema=public) — **218 tables**.
2. Introspected `information_schema.columns` — full column metadata for all
   218 tables. Saved to `_rec_tmp/db_columns.json`.
3. Introspected `pg_type` + `pg_enum` — **63 enums** with all values. Saved to
   `_rec_tmp/db_enums.json`.
4. Parsed `prisma/schema.prisma` — **218 models**, **60 enums**.
5. Compared model-by-model, column-by-column. Output in
   `_rec_tmp/drift_report.json`.

## Headline result

> **All 218 DB tables already have a Prisma model.** The 115-table gap
> described in `prisma/RECONCILE_TODO.md` has been fully closed in a prior
> pass — there are no tables left to promote.

Because nothing needs to be added, `schema.prisma` was not modified. All
follow-up work is column-level drift, documented in
`RECONCILE_DRIFT_2026_04_22.md`.

## Per-table classification

| Classification | Count | Action |
|---|---:|---|
| Already modeled in Prisma | **218** | None — table-level reconciled |
| Needs promotion (new model) | 0 | — |
| Raw-SQL-only (keep unmodeled) | 0 | — |
| Legacy/dead (flag for drop) | 0 | — |
| Staging (Bolt / BPW / Hyphen) | 0 unmodeled — all already in schema | — |

Notes on the RECONCILE_TODO.md tags:

- **STAGING** tables (`Bolt*`, `Bpw*`, `Hyphen*`) — modeled in Prisma today.
  No change.
- **RAW-SQL** tables (`AuditLog`, `ClientError`, `ServerError`, `AlertIncident`,
  `AlertMute`, `SecurityEvent`, `SlowQueryLog`, `UptimeProbe`, `EmailQueue`,
  `EngineSnapshot`, `AutomationLog`) — modeled in Prisma today. No change.
- **Community_legacy** — still in schema as a side-by-side with `Community`,
  and triggers a pre-existing `Community_pkey` collision in `prisma validate`
  (see drift doc).

## Column-level drift (real problems found)

See `prisma/RECONCILE_DRIFT_2026_04_22.md` for the full analysis.

Headline numbers:

| Kind | Count |
|---|---:|
| Schema declares field, DB missing column | **14** |
| DB has column, schema missing field | **160** |
| Nullability mismatch | **48** |
| Type mismatch (scalar incompatible with udt) | **0** |
| Enums in DB but not in schema (orphaned, no column uses them) | 4 |
| Enums in schema but not in DB (`POCategory` — actively used) | 1 |

## Actions taken in this pass

- ✅ Enumerated every DB table and enum; verified all 218 tables already have
  Prisma models.
- ✅ Built column-level drift report.
- ✅ Wrote `RECONCILE_DRIFT_2026_04_22.md` (findings, recommendations).
- ✅ Wrote this report.
- ❌ No changes to `schema.prisma` — none needed at the table level, and the
  rules forbid editing existing models to fix column-level drift.

## Validation status

- `npx prisma validate` — **fails**, but the 2 errors (`Community_pkey` name
  collision between `Community` and `Community_legacy`) are **pre-existing**
  and unrelated to this pass. They must be fixed by a separate PR that
  touches existing models.
- `npx prisma generate` — not run (validate must pass first).
- `npx tsc --noEmit` — not run (schema validate is the upstream gate).

## Table promotions count

| Metric | Count |
|---|---:|
| Tables promoted (new models added) | **0** |
| Tables documented as raw-only / staging | 0 (all already modeled) |
| Tables flagged as legacy for future cleanup | 1 (`Community_legacy` — PK collision) |
| `schema.prisma` lines added | 0 |
| `prisma validate` status | Fails with 2 pre-existing errors |
| `tsc --noEmit` status | Not run |

## Recommended next PRs (not in this scope)

1. **P0 — Fix `Community_pkey` collision.** Rename `Community_legacy`'s PK
   map so `prisma validate` passes.
2. **P0 — Fix `PurchaseOrder.category`.** Either create the `POCategory` enum
   + column in DB, or drop from schema. Currently the app will fault on any
   write touching it.
3. **P1 — Add drifted columns to models.** 33 models, 160 columns. Group by
   module (Builder, Vendor, Product, Contract, Quote, Job, PurchaseOrder,
   Invoice, Staff, SyncLog, Order, Payment, Message, etc.) so each PR is
   reviewable.
4. **P1 — Resolve 6 high-risk nullability mismatches** where DB is NOT NULL
   and Prisma declares optional.
5. **P2 — Decide on 4 orphan DB enums** (keep and promote `DoorStatus` +
   `DoorEventType` into `DoorEvent` / `DoorIdentity` models, or drop).
