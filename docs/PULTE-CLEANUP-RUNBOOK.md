# Pulte zombie-Job cleanup runbook

**Script:** `scripts/_cleanup-pulte-zombies.mjs`
**Authored:** R8-PULTE-ZOMBIES @ HEAD `6169e25` (2026-04-24)
**Status:** Ready for review. **Not yet applied to prod.** Nate runs after sign-off.

---

## What happened

Pulte (Pulte / Centex / Del Webb) was lost as a customer on **2026-04-20**. Doug
Gough (Senior Procurement) confirmed Pulte is moving the Treeline community to
84 Lumber and that Mobberly Farms already moved in March; the in-person renewal
meeting was declined. See `memory/customers/pulte.md` and CLAUDE.md.

`docs/AUDIT-DATA-REPORT.md` (anomaly #3) found the carryover in prod:

| Status          |    n |
|:----------------|-----:|
| CLOSED          | 1497 |
| **COMPLETE**    |  **246** |
| CREATED         |    4 |
| IN_PRODUCTION   |    2 |

The 246 `COMPLETE` rows are the "zombies": delivered work that never moved to
`CLOSED`, so they keep showing up in active-ops filters that exclude only
`CLOSED` / `INVOICED`. Confirmed today via read-only query — exact match to
audit's 246 (Nate's "252" had 6 jobs of drift since last count).

## Why we're not adding a column

The mission asked: prefer `archivedAt` if it exists, else `closedAt`, else add
a tag/note. **Neither field exists on `Job`** — full grep of `prisma/schema.prisma`
confirms no `archivedAt` and no `closedAt` anywhere. Job has no general-purpose
tag/notes column either; `buildSheetNotes` is operational, and `DecisionNote`
requires a `Staff.authorId` FK with `onDelete: Restrict` — not a clean fit for
a script.

The `JobStatus` enum already defines the answer: `CLOSED` is documented as
"Payment received, job archived" (schema.prisma line 1136). It is the canonical
terminal state. The audit report's recommended SQL uses the same transition
(`AUDIT-DATA-REPORT.md` § "252 Pulte zombies — recommended cleanup SQL").

**Field chosen: `Job.status` — transition `COMPLETE` → `CLOSED`.** No schema
change required. Fully reversible.

## What the script does

Three phases, each statement separate (pattern from
`scripts/_apply-bugfix-migration.mjs`):

1. **Inventory** (`$queryRawUnsafe`, read-only)
   - Lists `Builder` rows matching `pulte|centex|del webb` (ILIKE on `companyName`).
   - Counts Pulte `Job` rows by status (regex match on denormalized `Job.builderName`).
   - Reports `COMPLETE` total, eligible (older than `SKIP_DAYS`), and skipped.
2. **Cleanup** (`$executeRawUnsafe`, gated on `APPLY=1`)
   - `UPDATE "Job" SET status='CLOSED', "updatedAt"=NOW() WHERE LOWER("builderName") ~ 'pulte|centex|del webb' AND status='COMPLETE' AND ("completedAt" IS NULL OR "completedAt" < NOW() - INTERVAL '<SKIP_DAYS> days')`.
   - **Idempotent**: re-running after success matches 0 rows (status filter
     excludes the now-CLOSED rows).
   - Touches **only** rows in `COMPLETE`. Does not touch `CREATED`,
     `IN_PRODUCTION`, `CLOSED`, `INVOICED`, or any other status.
3. **Verify** (`$queryRawUnsafe`, read-only)
   - Re-counts remaining `COMPLETE` Pulte jobs and total `CLOSED` Pulte jobs.
   - Warns if remaining COMPLETE exceeds the expected skip-window count.

### Match logic

Match is on the **denormalized** `Job.builderName` field (regex
`pulte|centex|del webb`, case-insensitive). This is the same matcher the audit
used and catches all 246 zombies, including the 95 with no live `Order→Builder`
FK link. Only one row in `Builder` matches Pulte today (`Pulte Homes`,
`cmmzrun6g029693opxsz3wu2t`) — the other Pulte-tagged jobs are denormalized-only.

## Pre-run checks

Before running with `APPLY=1`:

1. **Take a Neon snapshot.** Tag suggestion:
   `pre-pulte-zombie-cleanup-2026-04-24`. Neon branching is the cheapest
   rollback path even though every change is also reversible by inverse SQL.
2. **Run the script in dry-run first** (default mode — see below). Confirm:
   - `Pulte/Centex/Del Webb Builder rows: 1` (or whatever is current)
   - `COMPLETE total` matches the audit's number (was 246 today)
   - `COMPLETE eligible` matches what you intend to update
3. **Decide on `SKIP_DAYS`.** Default is `7` (audit's recommendation —
   protects work that just completed). Today that gates at 109 of 246. **Given
   Pulte is fully lost on 2026-04-20 and there is no fresh work to protect,
   `SKIP_DAYS=0` is reasonable** to clear the full backlog in one pass.

## How to run

From `abel-builder-platform/`:

```bash
# 1. Dry run — default. No mutations. Shows what would happen.
node scripts/_cleanup-pulte-zombies.mjs

# 2. Same dry run, no skip window:
SKIP_DAYS=0 node scripts/_cleanup-pulte-zombies.mjs

# 3. Apply with default 7-day skip window (109 of 246 today):
APPLY=1 node scripts/_cleanup-pulte-zombies.mjs

# 4. Apply with no skip window (clear all 246 in one pass):
APPLY=1 SKIP_DAYS=0 node scripts/_cleanup-pulte-zombies.mjs
```

Re-running after a successful apply is safe — the second pass updates 0 rows.

## Expected output (dry run, today's data)

```
[1/3] Inventory phase (read-only)...
  Pulte/Centex/Del Webb Builder rows: 1
    cmmzrun6g029693opxsz3wu2t — Pulte Homes
  Pulte Jobs by status (matched on Job.builderName regex):
  CLOSED        : 1497
  COMPLETE      : 246
  CREATED       : 4
  IN_PRODUCTION : 2
  COMPLETE total                 : 246
  COMPLETE eligible (>7d)        : 109
  COMPLETE skipped  (≤7d)        : 137

[2/3] Cleanup phase...
  DRY RUN — would set status=CLOSED on 109 Job rows.

[3/3] Verify phase (read-only)...
  COMPLETE Pulte Jobs remaining: 246
  CLOSED   Pulte Jobs total    : 1497
```

After `APPLY=1 SKIP_DAYS=0` (preferred):

```
[2/3] Cleanup phase...
  APPLY=1 — running UPDATE...
  246 rows updated to status=CLOSED.

[3/3] Verify phase (read-only)...
  COMPLETE Pulte Jobs remaining: 0
  CLOSED   Pulte Jobs total    : 1743
  OK — only the <0d skip-window jobs remain in COMPLETE.
```

## Rollback

Every row's prior state is recoverable. The script only changes one column on
matched rows. If you need to undo:

```sql
-- Recover everything (only safe right after a single run; later writes may
-- have legitimately moved newer jobs into CLOSED).
UPDATE "Job"
SET status = 'COMPLETE', "updatedAt" = NOW()
WHERE LOWER("builderName") ~ 'pulte|centex|del webb'
  AND status::text = 'CLOSED'
  AND "updatedAt" >= '<the apply timestamp>';
```

For a cleaner rollback, restore from the Neon snapshot taken in pre-run check 1.

## What this does NOT do

These are separate workstreams — flagged in the audit, not in scope here:

- **22 orphan `Invoice.builderId` rows** pointing at 3 ghost Pulte/legacy
  Builder IDs (`cmmzruo7q029o93oppxwad5zs`, `cmmzrumbv028o93op5n6atwl8`,
  `cmmzrulpd028a93opehwtn9vt`). Audit anomaly #2 — needs Nate's call on
  re-pointing vs. UI fallback, plus a `@relation` add to schema.
- **The 14 misassigned PMs** (Brittney 137 + others 14) on Pulte
  COMPLETE/active jobs. Audit anomaly #4. Once these jobs go to `CLOSED`, the
  PM dashboards stop surfacing them, but the `assignedPMId` itself is
  unchanged. The audit recommends a separate sweep:
  `UPDATE "Job" SET "assignedPMId"=NULL WHERE LOWER("builderName") ~ 'pulte|centex|del webb' AND status IN ('CLOSED','COMPLETE')`.
- **20 active jobs assigned to inactive Staff** (audit anomaly #5). Unrelated
  to Pulte; separate fix.
- **Open Pulte orders / POs** (`IN_PROD n=2 $2.2K + RECEIVED n=24 $24.8K =
  $26.9K`). The 21-PO / $32.5K cancel/reduce work in CLAUDE.md is being run
  outside this script.
- **CREATED (4) and IN_PRODUCTION (2) Pulte jobs.** Out of scope — these
  aren't zombies, they're (apparently) live work that hasn't shipped. Confirm
  with Brittney before forcing them to CLOSED.
- **Schema additions.** No `@relation` adds, no new columns, no new indexes.

## Sign-off checklist

- [ ] Neon snapshot taken (`pre-pulte-zombie-cleanup-2026-04-24` or similar)
- [ ] Dry run output reviewed; counts match audit (`246` COMPLETE)
- [ ] `SKIP_DAYS` decision logged (recommend `0` given Pulte is fully lost)
- [ ] `APPLY=1` run completed; verify phase shows `COMPLETE remaining = 0`
- [ ] Spot-check Aegis ops dashboard — Pulte jobs no longer in active filters
- [ ] (Optional) Schedule the assignedPMId null-out sweep as a follow-up
