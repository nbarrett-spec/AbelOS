# QuickBooks Sync — Kill or Build Decision

**For:** Dawn Meehan (Accounting Manager)
**From:** Engineering (Wave-2 / Agent B7)
**Date:** 2026-04-23
**Decision owner:** Dawn + Nate, Tuesday post-launch

---

## TL;DR

We have **scaffolding, not sync**. QuickBooks code in Aegis today is: 1 stub library (239 lines), 1 status endpoint (44 lines), 1 disabled "Connect" page (230 lines), 4 engine read-through routes (59 lines total, all NUC-snapshot-based — not Aegis → QB), one empty `QBSyncQueue` table, and `qbTxnId`/`qbSyncedAt` columns sprinkled on Builder/Invoice/PurchaseOrder/MonthlyClose. **Zero rows have ever been written. No sync has ever run.** A related decision was already made on 2026-04-22 (Nate, solo): kill the QuickBooks **Desktop** Web Connector path and scaffold **QuickBooks Online** (QBO) OAuth2 instead. See `memory/projects/quickbooks-decision.md`. The open question for Dawn is different and smaller: **do we finish the QBO wiring (Option B), kill the whole thing and export CSV/IIF files instead (Option A), or ship a one-way export-only middle ground (Option C)?**

**My recommendation: C (one-way export).** It is 3-5 days of work, gives Dawn a clean close process without manual data entry, matches how she already uses QB, and carries near-zero risk. Full QBO two-way sync (Option B) is ~10-14 days and adds conflict-resolution surface area that Dawn doesn't need.

---

## Current state

### Models in schema (Prisma)
From `docs/DEAD-MODEL-REPORT.md` and `prisma/schema.prisma`:

| Model | Rows | Lines in schema | Purpose |
|---|---:|---:|---|
| `QBSyncQueue` | **0** (ZERO — flagged dead) | 20 (lines 5079-5099) | Pending-sync queue for the old QB Desktop path |
| `SyncLog` | 1,585 (ACTIVE) | shared | Generic sync-operation audit trail (used by InFlow, BuilderTrend, Hyphen today; not by QB) |

Fields on existing models (drifted-in columns, not their own model):

| Where | Column | Purpose | Used? |
|---|---|---|---|
| `Builder` | `qbListId`, `qbSyncedAt` | Map Aegis builder → QB customer | No — never written |
| `Invoice` | `qbTxnId`, `qbSyncedAt`, `qbSyncStatus` | Map Aegis invoice → QB invoice | No — never written |
| `PurchaseOrder` | `qbTxnId`, `qbSyncedAt` | Map Aegis PO → QB bill | No — never written |
| `MonthlyClose` (table exists, not in schema.prisma) | `qbSynced`, `qbSyncedAt`, `qbSyncedById` | Close checklist "QB synced" step | Yes — written by the stub, but the stub only marks the step done, no data moves |

### API routes present

From `Glob src/app/**/quickbooks*` and `Grep "quickbooks|QuickBooks|QBO"`:

| Route | Lines | % complete | Notes |
|---|---:|---:|---|
| `src/app/api/ops/integrations/quickbooks/status/route.ts` | 44 | **100%** | Real endpoint, reports stub status, reads `IntegrationConfig` row if present |
| `src/app/ops/integrations/quickbooks/page.tsx` | 230 | **UI shell only** | Disabled "Connect QuickBooks" button with "Coming in phase 2" tooltip |
| `src/app/api/v1/engine/data/quickbooks/health/route.ts` | 18 | **read-only passthrough** | Serves snapshot from NUC engine — does not move data to/from QB |
| `src/app/api/v1/engine/data/quickbooks/ar-aging/route.ts` | 13 | **read-only passthrough** | Same — reads a `quickbooks:ar_aging` snapshot stored by the NUC |
| `src/app/api/v1/engine/data/quickbooks/profit-loss/route.ts` | 15 | **read-only passthrough** | Same |
| `src/app/api/v1/engine/data/quickbooks/cash-flow/route.ts` | 13 | **read-only passthrough** | Same |

**Crucially missing:** no `webconnector/route.ts`, no `qwc/route.ts`, no OAuth callback route, no sync-trigger route. The docs under `docs/QUICKBOOKS_DESKTOP_INTEGRATION.md` (430 lines) and `docs/QB_DESKTOP_QUICK_START.md` (225 lines) describe endpoints that **do not exist in the codebase** — they describe the killed Desktop path.

### Library code

| File | Lines | Status |
|---|---:|---|
| `src/lib/integrations/quickbooks.ts` | 239 | QBO-shaped wrapper. All sync methods (`syncInvoices`, `syncPayments`, `syncJournals`, `syncMonthEndToQuickBooks`, `pushInvoiceToQuickBooks`) return `{skipped: true, reason: 'not implemented yet'}` or the legacy `{ok: false, 'qb_not_configured'}` envelope. Real OAuth2, real HTTP calls: **not written**. |
| `src/lib/integrations/quickbooks-desktop.ts` | — | **File does not exist.** Despite being documented, it was never committed (or was deleted in the 4/22 QBWC kill). |
| `src/lib/integrations/registry.ts` | 3 lines of QB config | Declares `quickbooks` as a known integration key with config path; does not implement sync. |
| `src/lib/engine-snapshot.ts` | 1 comment line | Mentions QB in a header comment listing engine data sources. |

**Total committed QB code: ~520 lines** (239 lib + 44 status + 230 UI page + 59 engine passthroughs + 3 registry). Of that, **~150 lines are real** (status endpoint, registry, engine passthroughs) and **~370 lines are scaffolding that does nothing** (stub methods returning `skipped: true`, disabled UI button, types).

### Crons
`Grep "quickbooks|QuickBooks|QBO" src/app/api/cron/`: **zero matches**. No QB cron exists. Nothing is running on a schedule. `vercel.json` has no QB cron either.

### What works today
1. The status endpoint `GET /api/ops/integrations/quickbooks/status` returns a real response: "phase: phase2-stub, connected: false, credentialsPresent: false."
2. The Integrations page shows QuickBooks as a known integration with a "not connected" badge.
3. The disabled "Connect QuickBooks" button exists, tooltip reads "Coming in phase 2."
4. The month-end close workflow (`/ops/portal/accounting/close`) has a "qb_sync" button — clicking it calls the stub, which returns `{ok: false, errors: ['qb_not_configured']}` and the `qbSynced` checkbox stays unchecked. No error is surfaced to Dawn beyond the inline message.
5. The NUC engine passthrough routes (`/api/v1/engine/data/quickbooks/*`) return pre-fetched QB reports (AR aging, P&L, cash flow, health) — these pull from `EngineSnapshot` storage populated by the NUC cluster, not from live QB. **This is the only place QB data is actually being read**, and it's read-only, engine-scoped, and doesn't round-trip to QB.

### What's broken / stubbed
1. **Every write path is stubbed.** `syncInvoices()`, `syncPayments()`, `syncJournals()`, `syncMonthEndToQuickBooks()`, `pushInvoiceToQuickBooks()` all return the "not implemented" envelope.
2. **No OAuth2 handshake.** `.env.example` lists `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID`, `QBO_REFRESH_TOKEN`, `QBO_ACCESS_TOKEN`, `QBO_API_BASE` — but there's no `/auth/quickbooks` route, no `/callback` handler, no token-exchange code.
3. **`QUICKBOOKS_ONLINE` is not in the `IntegrationProvider` enum.** The status route works around this with `$queryRawUnsafe`; anything type-safe via Prisma fails.
4. **Docs describe a system that doesn't exist.** `docs/QUICKBOOKS_DESKTOP_INTEGRATION.md` and `docs/QB_DESKTOP_QUICK_START.md` (655 lines combined) reference the killed Desktop path. Any new hire reading them will be misled.
5. **Schema drift.** `MonthlyClose.qbSynced` / `qbSyncedAt` / `qbSyncedById` exist in the live DB and are written by raw SQL in `src/app/api/ops/finance/monthly-close/route.ts`, but are **not in `schema.prisma`**.

---

## Option A — Kill it

**Premise:** Accept that Dawn does month-end in QB Desktop, and have Aegis produce export files (CSV / IIF) she manually imports when she's ready.

### Delete these models
- `QBSyncQueue` — 0 rows, flagged ZERO in dead-model report (row 104 of `docs/DEAD-MODEL-REPORT.md`).

### Delete these columns (with care — some are written even if unused)
- `Builder.qbListId`, `Builder.qbSyncedAt` — never written.
- `Invoice.qbTxnId`, `Invoice.qbSyncedAt`, `Invoice.qbSyncStatus` — never written.
- `PurchaseOrder.qbTxnId`, `PurchaseOrder.qbSyncedAt` — never written.
- `MonthlyClose.qbSynced`, `qbSyncedAt`, `qbSyncedById` — **written by monthly-close route (line 199).** Don't drop; instead rename step to "exportGenerated" or similar.

### Delete these routes
- `src/app/api/ops/integrations/quickbooks/status/route.ts` (44 lines)
- `src/app/ops/integrations/quickbooks/page.tsx` (230 lines)
- The engine passthroughs (`/api/v1/engine/data/quickbooks/*`, 59 lines) only if Nate confirms the NUC engine no longer sends QB snapshots. **Ask first — these may be consumed by the NUC cluster.**

### Delete these lib files
- `src/lib/integrations/quickbooks.ts` (239 lines) — full delete.
- Remove the `quickbooks` entry from `src/lib/integrations/registry.ts` (3 lines).
- Update `src/lib/engine-snapshot.ts` header comment (1 line).

### Delete these docs
- `docs/QUICKBOOKS_DESKTOP_INTEGRATION.md` (430 lines)
- `docs/QB_DESKTOP_QUICK_START.md` (225 lines)
- Update `docs/INDEX.md` to remove any QB links.

### Add this (small)
- New route: `POST /api/ops/finance/monthly-close/export` — writes a CSV or IIF file of the month's invoices / payments / journals to `/tmp` or a signed S3 URL. ~80 lines.
- New button on `/ops/portal/accounting/close`: "Download QB import file." ~20 lines.

### Estimated cleanup
- **Deletions:** ~1,200 lines across code + docs (520 code + 655 docs + migration).
- **New work:** ~100 lines for the export route + button.
- **Commits:** 3 (delete code, delete docs, add export).
- **Hours:** 4-6.
- **Schema drift fix:** 1 migration to drop the unused columns.

### Dawn's workflow after Option A
- She stays in QB Desktop exactly as she does today.
- At month-end, she clicks "Download QB import file" on the close page. Aegis gives her a CSV (or IIF) with invoices, payments, and journals for that month.
- She imports it into QB via File → Utilities → Import → IIF Files (or the CSV importer if we go CSV).
- **What she loses vs. today:** nothing. Nothing was working before.
- **What she gains:** zero double-entry. Right now she's probably manually re-typing invoices into QB because Aegis is the source of truth for sales.

### Risk
- The AR aging / P&L / cash flow engine snapshots (the NUC passthrough routes) may depend on QB being "connected" conceptually. Needs Nate to confirm. If yes, leave the engine routes alone and only delete the `/ops/integrations/quickbooks/*` Aegis-side code.
- If Dawn expects real-time sync later, she'll have to re-litigate the decision.

---

## Option B — Build it out (full QBO two-way sync)

**Premise:** Complete the 4/22 scaffold. Real OAuth2, real `syncInvoices`/`syncPayments`/`syncJournals`, real cron.

### Scope to finish
1. **OAuth2 authorization-code flow.** New routes: `/api/auth/quickbooks/authorize`, `/api/auth/quickbooks/callback`, token refresh helper. Persist refresh token on `IntegrationConfig`.
2. **Add `QUICKBOOKS_ONLINE` to the `IntegrationProvider` enum.** Migration to widen the enum + backfill zero rows.
3. **Implement `syncInvoices()`.** For each Aegis Invoice where `qbTxnId IS NULL`: create a QB Invoice entity via `POST /v3/company/{realmId}/invoice`, store the returned `Id` in `qbTxnId`, mark `qbSyncedAt = now()`.
4. **Implement `syncPayments()`.** Same pattern, keyed on invoice + customer. Requires the invoice to be synced first.
5. **Implement `syncJournals()`.** Post month-end closing entries as `JournalEntry` objects. This is the Dawn-critical one.
6. **Customer sync.** Builders need `qbListId` populated before invoices can reference them. Either add a `syncCustomers()` method or fold it into `syncInvoices()` as a pre-step.
7. **Cron.** Register `quickbooks-sync` in `vercel.json`, daily 6am. 15-30 min runtime budget, like the InFlow / Hyphen crons.
8. **Error handling & retries.** `QBSyncQueue` becomes the retry mechanism — re-wire the stubs to enqueue failed items with `status=QUEUED` and have the cron drain the queue.
9. **UI.** Enable the "Connect QuickBooks" button; build a "QB sync health" dashboard (queue depth, last-sync time, failed items) on the `/ops/integrations/quickbooks` page.
10. **Delete the Desktop docs** (`QUICKBOOKS_DESKTOP_INTEGRATION.md`, `QB_DESKTOP_QUICK_START.md`) and replace with a QBO doc.

### Estimated effort
- **Dev days:** 10-14 for one engineer familiar with OAuth and the Intuit API. Add 2-3 days for Dawn-facing UI polish.
- **Lines of code added:** ~1,200-1,800 (OAuth + sync bodies + cron + UI).
- **Testing:** needs a QB Online sandbox realm; Intuit gives these out free but they must be configured.

### Dependencies
- **Intuit developer account.** Nate needs to create an app at developer.intuit.com to get `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`.
- **A real QBO company.** Dawn currently uses QB Desktop per the CLAUDE.md. **If Dawn is on Desktop, QBO sync doesn't help her directly** — she'd have to either migrate to QBO or Dawn keeps the Desktop book separate and the QBO sync runs to a parallel / future QBO file. **This is the biggest unknown blocking the decision.**
- OAuth scopes: `com.intuit.quickbooks.accounting`.
- Sandbox + production app credentials.

### What Dawn gets
- Every Aegis invoice appears in QB automatically within 24 hours.
- Every payment Aegis records appears in QB.
- Month-end journals post automatically; she just reviews them.
- AR aging in QB stays in lockstep with AR aging in Aegis — no reconciliation drift.
- Fewer manual JEs at close: ~5-10 minutes per month instead of ~2-3 hours.

### Risk
- **QB is on Desktop today.** QBO sync is only useful if Abel migrates to QBO, OR if Dawn is willing to run a parallel QBO company for the sync'd data (most CFOs would not be). **Resolve this first.**
- **Sync conflicts.** If someone edits an invoice in QB after Aegis pushed it, the next sync pass can overwrite their change or fail loudly. Two-way sync is always this hard.
- **QB API rate limits.** Intuit allows ~500 req/min for QBO, which is plenty, but bulk backfill of existing invoices (Aegis has 4,124 rows in `Invoice`) needs batching + backoff.
- **Maintenance burden.** Token refresh, webhook delivery, schema-drift between Aegis Invoice and QB Invoice — ongoing care required. Budget ~4 hours/month.
- **Re-entering a lived-with pain.** Nate already killed the Desktop path once (4/22) because the maintenance cost was too high. Full QBO sync is lighter than Desktop, but the same failure modes exist.

---

## Option C — Middle ground: one-way export

**Premise:** Aegis generates a structured import file (IIF or CSV), Dawn imports it into QB Desktop herself at month-end. No API calls, no OAuth, no sync. Option A plus: a real export generator rather than just "whatever CSV we can cobble together."

### Scope
1. **IIF file generator.** Use QB's native IIF format (plain tab-delimited text) to produce an importable file with customers, invoices, payments, and optional month-end journal entries. Well-documented format; ~200 lines of code.
2. **Download button on `/ops/portal/accounting/close`.** Month-level toggle: "Generate QB import file for April 2026."
3. **Per-customer IIF fields.** If Dawn prefers CSV-over-IIF, swap the generator output. IIF is faster to import (single click in QB File → Utilities → Import).
4. **Audit log.** Every generated file gets logged to `AuditLog` with the month, generator version, record counts.
5. **Keep the engine passthrough routes alive** (`/api/v1/engine/data/quickbooks/*`) so the NUC cluster can continue reading QB snapshots.
6. **Delete the stub library and the Connect UI.** `src/lib/integrations/quickbooks.ts` goes away; `src/app/ops/integrations/quickbooks/page.tsx` goes away.
7. **Delete the misleading Desktop docs.** Same as Option A.

### Estimated effort
- **Dev days:** 3-5.
- **Lines of code added:** ~300-400 (IIF generator + button + audit).
- **Lines deleted:** ~1,100 (stub lib + UI page + misleading docs).

### Dawn's workflow after Option C
- She stays in QB Desktop.
- Month-end close in Aegis (`/ops/portal/accounting/close`) ends with a "Generate import file" step.
- She downloads one .IIF, imports it into QB (File → Utilities → Import → IIF Files).
- QB parses the file, creates the customers / invoices / payments / JEs.
- She reviews the imported entries in QB before closing the period.

### Why this is the sweet spot
- Zero OAuth plumbing.
- Zero running sync jobs to monitor.
- Zero conflict-resolution surface (she imports into a fresh month; if something's wrong, she just re-runs).
- Matches Dawn's actual workflow (she wants control, she wants to review before posting).
- Works whether Abel stays on Desktop or moves to QBO later (IIF is Desktop-native but QBO also has a CSV importer).
- If/when Abel moves to QBO, we can bolt on Option B as a future phase without throwing this away.

---

## Recommendation

**Go with Option C — one-way IIF export.**

Why, citing the evidence:

1. **Nate already made the hard call once.** On 4/22 he killed QBWC because "QBWC fails silently when the host PC reboots, the Web Connector service stops, or the token file goes stale" (`memory/projects/quickbooks-decision.md`, line 16). Full QBO sync (Option B) has the same operational cost shape — just with different failure modes (token refresh, rate limits, conflict resolution). The 4/22 reasoning applies here too.

2. **Dawn is on Desktop, not Online.** QBO sync (Option B) is a zero-value build until that changes. Per CLAUDE.md line 39: "QuickBooks Desktop (QB Sync Queue models exist, not fully wired — decision pending to build or kill)." Per the 4/22 decision doc line 18: "Dawn's close process is already half in QuickBooks Online" — but this assertion needs to be **verified with Dawn directly** (it contradicts the CLAUDE.md). **This contradiction is the single biggest unknown.**

3. **The thing that's committed isn't even costing us much to delete.** Per `docs/DEAD-MODEL-REPORT.md` row 104: `QBSyncQueue` has 0 rows. Per `Grep`, zero crons reference QB. Per `Read`, every sync method returns `skipped: true`. We're deleting cold scaffolding, not live infrastructure.

4. **Option C is the build the business actually needs.** Dawn's pain isn't "my AR aging is out of sync with Aegis" (she probably doesn't reconcile them at all today). Her pain is "I'm re-typing invoices." An IIF export kills re-typing. Everything beyond that is over-engineering for a single accountant who, per CLAUDE.md, was hired 5.5 months ago and handles AR/AP/payroll end-to-end without a sync in place.

5. **The dead-model report confirms the scale.** QBSyncQueue is 1 of 111 ZERO-row models. Aegis is still in "tighten up after launch" mode, not "build more integrations" mode. Adding Option B's surface area 10 days after launch is the wrong tempo.

**Do C now. Leave Option B as a future upgrade path if and when Abel migrates to QBO.**

---

## Decision needed from Dawn

Answer these before we write a line of code:

1. **Are you on QB Desktop or QB Online?** (CLAUDE.md says Desktop; the 4/22 decision doc implies you're partially on Online. Which is it?)
2. **How do invoices get into QB today?** Manual re-entry? CSV import? Not at all?
3. **How many minutes / hours per month do you spend on that part?**
4. **Do you want to own the "import" step** (you click a button in QB to pull the file in) or do you want it to happen without you?
5. **IIF or CSV for the export format?** IIF is a single-click import in Desktop; CSV is friendlier to edit in Excel before importing.

If the answers are "Desktop, manual re-entry, 2+ hours/month, I want to own import, IIF is fine" — we ship Option C Monday-after-launch.
If the answers are "Online, I need real-time sync, I don't want to touch it" — revisit Option B and budget 2 weeks.
If the answers are "nothing's broken, I don't care" — Option A (kill the scaffold and move on).

---

## If we kill: delete list

### Files to delete outright (Option A or C)
```
src/lib/integrations/quickbooks.ts                             # 239 lines
src/app/ops/integrations/quickbooks/page.tsx                   # 230 lines
src/app/api/ops/integrations/quickbooks/status/route.ts        #  44 lines
docs/QUICKBOOKS_DESKTOP_INTEGRATION.md                         # 430 lines (misleading — describes killed path)
docs/QB_DESKTOP_QUICK_START.md                                 # 225 lines (same)
```

### Files to delete conditional on Nate's confirm (engine routes)
```
src/app/api/v1/engine/data/quickbooks/health/route.ts          #  18 lines
src/app/api/v1/engine/data/quickbooks/ar-aging/route.ts        #  13 lines
src/app/api/v1/engine/data/quickbooks/profit-loss/route.ts     #  15 lines
src/app/api/v1/engine/data/quickbooks/cash-flow/route.ts       #  13 lines
```
**Keep these if the NUC cluster writes `quickbooks:*` snapshots.** Nate to confirm.

### Files to edit (not delete)
```
src/lib/integrations/registry.ts         # remove the 'quickbooks' block (~10 lines)
src/lib/engine-snapshot.ts               # update header comment (1 line)
.env.example                             # remove QBO_* and QBWC_* blocks (~12 lines)
prisma/schema.prisma                     # drop qbTxnId / qbListId / qbSyncedAt / qbSyncStatus columns
                                         # from Builder, Invoice, PurchaseOrder. KEEP MonthlyClose ones
                                         # (actively written) unless we rename the close step.
docs/INDEX.md                            # remove QB links
```

### Migration
One migration titled `drop_qb_scaffold_columns` that removes:
- `Builder.qbListId`, `Builder.qbSyncedAt`
- `Invoice.qbTxnId`, `Invoice.qbSyncedAt`, `Invoice.qbSyncStatus`
- `PurchaseOrder.qbTxnId`, `PurchaseOrder.qbSyncedAt`
- The `QBSyncQueue` table entirely

### Commit message template
```
chore(qb): kill QB sync scaffold per Dawn decision 2026-04-28

QBSyncQueue had 0 rows since launch (docs/DEAD-MODEL-REPORT.md).
Every sync method was returning {skipped: true}. Option C shipping
separately as docs/QB-EXPORT-DESIGN.md.

Deleted:
- src/lib/integrations/quickbooks.ts (stub, 239L)
- src/app/ops/integrations/quickbooks/page.tsx (disabled UI, 230L)
- src/app/api/ops/integrations/quickbooks/status/route.ts (44L)
- docs/QUICKBOOKS_DESKTOP_INTEGRATION.md (describes killed QBWC path)
- docs/QB_DESKTOP_QUICK_START.md (same)

Schema: dropped qb* columns on Builder/Invoice/PurchaseOrder.
MonthlyClose.qbSynced* retained — still written by close flow;
rename follows in next PR.

Ref: docs/QB-DECISION.md, memory/projects/quickbooks-decision.md
```

---

## Appendix — file references

- Current stub: `src/lib/integrations/quickbooks.ts`
- Current status route: `src/app/api/ops/integrations/quickbooks/status/route.ts`
- Current UI page: `src/app/ops/integrations/quickbooks/page.tsx`
- Month-end close call site: `src/app/api/ops/finance/monthly-close/route.ts` lines 7, 195, 199
- Integrations registry: `src/lib/integrations/registry.ts` lines 62-68
- Schema columns:
  - `prisma/schema.prisma` line 56 (Builder.qbListId)
  - `prisma/schema.prisma` line 57 (Builder.qbSyncedAt)
  - `prisma/schema.prisma` lines 1671-1673 (PurchaseOrder.qbTxnId / qbSyncedAt)
  - `prisma/schema.prisma` lines 1825-1828 (Invoice.qbTxnId / qbSyncedAt / qbSyncStatus)
  - `prisma/schema.prisma` lines 5079-5099 (QBSyncQueue model)
- Prior decision: `memory/projects/quickbooks-decision.md` (QBWC kill, 2026-04-22)
- Dead-model evidence: `docs/DEAD-MODEL-REPORT.md` line 104 (QBSyncQueue, 0 rows)
- Misleading docs (to delete): `docs/QUICKBOOKS_DESKTOP_INTEGRATION.md`, `docs/QB_DESKTOP_QUICK_START.md`
- `.env.example` QB blocks: lines 132-141 (QBO_*), line 326 (QBWC note)
