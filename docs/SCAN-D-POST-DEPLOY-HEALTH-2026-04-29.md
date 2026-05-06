# SCAN-D — Post-Deploy Health Audit (Aegis Wave + NUC Brain Readiness)

**Generated:** 2026-04-29 | **HEAD:** `d9610e5` | **Mode:** READ-ONLY
**Mission:** Determine whether the platform is stable enough to ship the NUC Brain wiring fix today, or if blockers must land first.

---

## TL;DR

| Item | State | Action |
|---|---|---|
| Migration `20260429_supply_chain_finance_upgrades` | committed, NOT applied | **APPLY FIRST** — Job PATCH will 500 on installer assignment without it |
| 3 new crons in vercel.json | live, fire tonight | safe to run pre-migration; none read new columns |
| `lib/cron.ts` registry drift | drift confirmed (3 crons missing/wrong) | **PATCH BEFORE** — `/admin/crons` will mark them missing/orphaned |
| `lib/mrp/bom-version.ts` | references non-existent `BomEntry.bomVersion` | dead code, no callers — won't 500 in prod, but leave note |
| Brain wiring 401 outage (44+ runs) | unchanged from SCAN-A8 | **safe to ship Brain fix today** — no upstream blocker |
| Critical path (orders, deliveries, invoices, payments) | working | wave was additive; rollback unnecessary |

**Recommendation:** Apply migration → patch cron registry drift → ship Brain wiring fix. All three can land within ~30 min sequentially. Brain fix does **not** need to wait for migration if Brain ingest only reads existing tables.

---

## 1. Schema migration status (gate-1)

**File:** `prisma/migrations/20260429_supply_chain_finance_upgrades/migration.sql`

```sql
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "installerId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "trimVendorId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "bomVersion" INTEGER DEFAULT 1;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paidMethod" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paidReference" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorConfirmedAt" TIMESTAMP;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorConfirmedDate" TIMESTAMP;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "vendorPONumber" TEXT;
```

All additive, all `IF NOT EXISTS`, all nullable (Job.bomVersion has DEFAULT 1). Zero risk to existing rows.

### Apply checklist

1. Backup prod Neon (`pre-d9610e5-2026-04-29` snapshot).
2. `npx prisma migrate deploy` against prod.
3. `npx prisma generate` (Vercel build does this on next deploy automatically).
4. Verify columns: `SELECT column_name FROM information_schema.columns WHERE table_name IN ('Job','PurchaseOrder') ORDER BY 1;`

### Routes/crons at risk if migration NOT applied

| Surface | File | Severity | Cause |
|---|---|---|---|
| **Job PATCH (installer assignment)** | `src/app/api/ops/jobs/[id]/route.ts:167-178` | **HIGH** — 500 | `validFields` now includes `installerId`, `trimVendorId`. Any PM who hits the install-assignee dropdown on `/ops/jobs/[jobId]` will trigger UPDATE on a column that doesn't exist. |
| `/ops/jobs/[jobId]` page | `src/app/ops/jobs/[jobId]/page.tsx:443,459-460` | depends on Job PATCH | Page calls PATCH with `installerId`/`trimVendorId` body fields — same 500 path. |
| Job GET | `src/app/api/ops/jobs/[id]/route.ts:24` (`SELECT j.*`) | **NONE** — `j.*` returns only existing columns; UI defaults to null | safe |
| `lockBomVersion()` | `src/lib/mrp/bom-version.ts:63` | dead code — **NO CALLERS** | references Job.bomVersion (added by migration) AND BomEntry.bomVersion (NOT in migration, NOT in schema) — both spots would 500 if ever called. Currently unreachable. |
| Reorder-calibration cron | `src/app/api/cron/reorder-calibration/route.ts` | **NONE** | only touches InventoryItem / DemandForecast / VendorProduct — pre-existing tables |
| Inventory-product-sync cron | `src/app/api/cron/inventory-product-sync/route.ts` | **NONE** | only touches Product / InventoryItem |
| Dead-stock-report cron | `src/app/api/cron/dead-stock-report/route.ts` | **NONE** | only touches InventoryItem / Product / MaterialPick |
| `auto-allocate.ts`, `auto-pick.ts`, `po-validation.ts` | `src/lib/mrp/*.ts` | **NONE** | none reference new columns |
| PO PATCH / receiving | various | **NONE** | new PO columns (paidAt etc.) are NOT read or written by any current production code path; finance/ap/payments explicitly notes they're "proposed in FIX-10 but have not landed." Forward-compatible. |

**Bottom line on migration:** the only 500 risk is Job PATCH for installer assignment. PMs may not hit it tonight, but it's user-visible if they do.

---

## 2. New cron risk

3 new crons in `vercel.json` (lines 199-210):

| Cron | Schedule (vercel.json) | Schedule (lib/cron.ts) | First fire |
|---|---|---|---|
| `reorder-calibration` | `0 2 * * *` (2 AM UTC daily) | `0 6 * * *` ← **DRIFT** | tonight 2 AM UTC |
| `inventory-product-sync` | `0 1 * * *` (1 AM UTC daily) | **NOT REGISTERED** | tonight 1 AM UTC |
| `dead-stock-report` | `0 11 * * 5` (Fri 11 AM UTC) | **NOT REGISTERED** | Friday 5/1 |

### Registry drift (P1)

`src/lib/cron.ts:301` lists `reorder-calibration` at `0 6 * * *` but `vercel.json:200` runs it at `0 2 * * *`. The other two new crons aren't listed at all.

**Effect:**
- `/admin/crons` page will flag `inventory-product-sync` and `dead-stock-report` as **orphaned** (running but not registered).
- `expectedMaxGapMinutes()` for `reorder-calibration` will be calculated from the wrong schedule and may stale-flag earlier than it should.
- Cron drift detector will emit false positives.

**Fix (5-min PR):** in `lib/cron.ts:260-301` REGISTERED_CRONS array, change `reorder-calibration` schedule string and add the two missing entries.

### Will they fire safely tonight?

Yes. None of the three reads any unapplied schema column. The handlers run their work, write CronRun rows, and finish. The only cosmetic side-effect is the dashboard misclassifying them.

---

## 3. Recent-wave rollback risk per commit

| Commit | Title | Rollback risk | Deferred items blocking other work |
|---|---|---|---|
| `d9610e5` | Cowork supply-chain + finance wave | **LOW** | (a) Migration unapplied — see §1. (b) Empty Unicode-bracket dir at `src/app/api/ops/jobs/[id]/` (OneDrive lock) — Nate to delete manually. (c) FIX-9/11/13/14 (Resend templates), FIX-20 (QB OAuth), FIX-25/26/29, GAP-7 widget, GAP-23 PO confirm UI, GAP-24 InFlow audit — all explicitly deferred per handoff. None block Brain. |
| `e570bf0` | AI model bump | **NONE** | trivial — fixed 404s caused by deprecated model snapshots. Already in prod and working. |
| `9004cbe` | 38-agent MWD + Finance portal wave | **LOW** | shipped at launch; no rollback signals visible. Brain depends on Job/Order/Invoice/Customer tables that this wave wrote against — all healthy. |
| `f635704` | /ops/projects fix | **NONE** | hotfix; isolated. |
| `ec1a7f6` | Tier 1+2 launch wave | **LOW** | foundational; production has been stable for 2 days under load. |

No commits flagged for rollback. Wave is additive.

---

## 4. Critical-path operational features

Reviewed file paths that own each path. All modified by the wave but consistent with existing contracts:

| Path | Status | Evidence |
|---|---|---|
| Order PATCH | working | `src/app/api/ops/orders/[id]/route.ts` unchanged in d9610e5 |
| Delivery completion | working | `src/app/api/ops/jobs/[id]/route.ts:305-334` adds Delivery auto-create on LOADED/IN_TRANSIT — non-blocking on failure |
| Invoice creation | working | `src/lib/invoicing/auto-invoice.ts` is NEW — wraps Invoice/Items/LienRelease in tx; only called from new `generate-invoice` endpoint |
| Payment recording | working | `src/app/api/ops/invoices/[id]/payments/route.ts:108-113` adds LienRelease auto-advance to READY when invoice → PAID. Pre-existing Invoice.paidAt (schema.prisma:1882) — unaffected by migration |
| Concurrent-write race (OneDrive) | one residual artifact | empty `[id]` dir at `src/app/api/ops/jobs/` per commit message — Next.js ignores empty dirs, no runtime impact |

No agent-reported file persistence issues resurfaced. tsc clean per commit message.

---

## 5. Email + alerting state

### Kill switches

- **`EMAILS_GLOBAL_KILL`** — gate at `src/lib/email.ts:70` and `src/lib/resend/client.ts:189`. Reads `process.env.EMAILS_GLOBAL_KILL === 'true'`. Workspace `.env` does NOT set this; `abel-builder-platform/.env` does NOT set this. **State is whatever Vercel env has** — not visible from local. If unset (default) → emails are LIVE.
- **`BUILDER_INVOICE_EMAILS_ENABLED`** — referenced from `src/app/api/ops/invoices/[id]/remind/route.ts` and `src/lib/notifications.ts`. Same env-only pattern.

**Action:** Nate verifies in Vercel project settings before any cron-driven email surface is enabled.

### Cron lying about success (per SCAN-A4)

| Cron | Lying? | Status |
|---|---|---|
| `hyphen-sync` | YES — returns SUCCESS with `result.skipped=true, reason=NO_HYPHEN_CONFIG` | **unfixed** as of d9610e5; no IntegrationConfig row for HYPHEN exists |
| `gmail-sync` | partial — 28% batch FAILURE rate from CC array-literal escape on a few specific Pulte threads | **unfixed**; rows still syncing for 99%+ messages |
| `inflow-sync` | NO — but `IntegrationConfig.lastSyncAt` not bumped, dashboard misreports | dashboard cosmetic only |
| `aegis-brain-sync` | NO — honestly FAILURE every run with HTTP 401 | the Brain wiring fix landing today is for this exact issue |

---

## 6. Brain readiness pre-conditions

### Dependency chain

```
NUC Brain useful insights
   ↑ requires
Aegis Job/Order/Invoice/Customer rows are accurate + fresh
   ↑ requires
Crons firing successfully (especially mrp-nightly, financial-snapshot, vendor-scorecard-daily)
   ↑ requires
Migration applied (so installerId/trimVendorId on Job don't 500 PMs editing the source data)
```

### Brain ingest tables

The Brain pulls from existing Aegis tables: `Order`, `Job`, `Invoice`, `Customer`/`Builder`, `Payment`, `Delivery`, `Vendor`. **None of the new columns** (installerId, trimVendorId, bomVersion, paidAt-on-PO, vendorConfirmedAt, etc.) are read by `scripts/aegis-to-brain-sync.ts` or any `/api/cron/aegis-brain-sync/route.ts` flow.

**Implication:** the Brain wiring fix (auth/header repair to resolve the HTTP 401) can ship **independently** of the migration. Migration is **not** a hard prerequisite for Brain ingest to start working.

### What the Brain fix unblocks

Once Brain ingest succeeds:
- 30 days of buffered events flow in (Aegis → Brain backfill within 65-min lookback per SCAN-A8 — older than that is lost).
- `EngineSnapshot` table starts populating (currently 0 rows).
- Daily `brain-synthesize` cron resumes producing briefings.
- Aegis `NucStatusCard` still shows offline until coordinator NUC physically sends heartbeat (separate concern; hardware-side per CLAUDE.md).

---

## 7. Recommended sequence (today, 2026-04-29)

| Step | Task | Time | Blocker for next? |
|---|---|---|---|
| 1 | Snapshot prod Neon (`pre-d9610e5-2026-04-29`) | 5 min | yes |
| 2 | `npx prisma migrate deploy` against prod-main | 2 min | no |
| 3 | Verify Job + PurchaseOrder columns added (SQL above) | 1 min | no |
| 4 | (parallel) Patch `lib/cron.ts` registry drift — 5-line PR adding `inventory-product-sync`, `dead-stock-report`, fixing `reorder-calibration` schedule | 10 min | no |
| 5 | **Ship NUC Brain wiring fix** (the actual mission today) | 30-60 min | independent — does NOT depend on 1-4 |
| 6 | Smoke test: trigger `aegis-brain-sync` manually, verify HTTP 200 + EngineSnapshot row created | 5 min | no |
| 7 | Optional: empty `[id]` dir cleanup at `src/app/api/ops/jobs/` (Windows Explorer, OneDrive paused) | 1 min | no |

### What to skip / defer

- **`bom-version.ts` BomEntry column issue** — file has zero callers; leave note in handoff for next wave to either add `BomEntry.bomVersion` migration + wire callers, or delete the dead helpers.
- Hyphen `IntegrationConfig` row insert — separate workstream (Brookfield integration), not on critical path today.
- Stripe webhook investigation — out of scope; revenue is 100% check/ACH/wire.
- BPW dead-code removal — already removed from cron schedule, can cleanup later.

---

## Appendix — files inspected

- `prisma/migrations/20260429_supply_chain_finance_upgrades/migration.sql`
- `prisma/schema.prisma` (Job, PurchaseOrder, Invoice, BomEntry models)
- `vercel.json`
- `src/lib/cron.ts`
- `src/app/api/ops/jobs/[id]/route.ts`
- `src/lib/mrp/auto-allocate.ts`
- `src/lib/mrp/auto-pick.ts`
- `src/lib/mrp/bom-version.ts`
- `src/lib/mrp/po-validation.ts`
- `src/app/api/cron/reorder-calibration/route.ts`
- `src/app/api/cron/inventory-product-sync/route.ts`
- `src/app/api/cron/dead-stock-report/route.ts`
- `src/app/api/ops/procurement/purchase-orders/[id]/route.ts`
- `src/app/api/ops/invoices/[id]/payments/route.ts`
- `src/app/api/ops/finance/ap/payments/route.ts` (confirms PO payment columns deferred)
- `src/app/api/ops/receiving/route.ts`
- `src/lib/email.ts`, `src/lib/resend/client.ts` (kill switch wiring)
- `docs/SCAN-A4-INTEGRATION-FRESHNESS.md`
- `docs/SCAN-A8-NUC-BRAIN-WIRING.md`
