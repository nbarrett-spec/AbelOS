# DB Health Report — 2026-04-24T19:30Z

**HEAD:** `74f6bbd` (fix(build): drop THOMAS_BUILDER_PATTERNS page export)
**Target:** Live Neon production DB via `DATABASE_URL`
**Mode:** READ-ONLY. No mutations issued. Tmp script `_tmp-health-orphans.mjs` deleted after run.
**Agent:** H2 (Monday-readiness sweep)

---

## TL;DR verdict

**YELLOW** — no RED blockers for Monday, but three material drifts remain from earlier reports that should be resolved before high-volume users are in the app.

- **267 PM-assignment anomalies** still present (identical to D10's earlier scan — Pulte cleanup + PM reassignment SQL are queued but not yet executed).
- **25 staff with expired invites** identical to D4's earlier count; 4 PMs verified healthy (Brittney + Thomas HEALTHY; Ben + Chad PENDING_RESET, but all can log in Monday).
- **Zero orphan allocations**, **zero zombie crons**, and the **JobType schema migration is verified applied** (14 enum values present, `Job.jobType` is a USER-DEFINED `JobType` column).
- **New finding:** 22 Invoices reference a deleted Builder (`cmmzruo7q029o93oppxwad5zs`, `cmmzrumbv028o93op5n6atwl8`) — unclear if these were cleaned during the pre-launch rebuild; needs investigation.
- **New finding:** 2 legacy cron jobs (`bolt-sync`, `bpw-sync`) have 150 consecutive failures each, never succeeded — likely dead/misconfigured, recommend disabling.
- **New finding:** `gmail-sync` has been failing every 15 min for the last hour with a raw-SQL array-literal parse error on `brittney.werner@abellumber.com` — active P2 to investigate.
- 3,527 PurchaseOrders sit in `status=RECEIVED` with line items where `receivedQty < quantity` — likely legacy data (pre-inflow migration convention of flagging POs received without receipt-line closeout). Worth a follow-up ticket, not a launch blocker.

---

## Section 1: Script re-runs

| Script | Exit | Summary |
|---|---|---|
| `verify-pm-assignments.mjs` | **1** | 627 active jobs scanned. 149 CORRECT, 267 anomalies = 11 misassigned (5 Brittney + 6 Ben), 252 ZOMBIE_LOST_BUILDER (Pulte), 2 ZOMBIE_INACTIVE_BUILDER (GH Homes, Truth Construction), 1 WRONG_ENTITY_TYPE (HWH Construction), 24 UNASSIGNED, 188 UNKNOWN_BUILDER. **Identical shape to D10's prior scan — drift not yet remediated.** Proposed fix SQL is printed in the script output for 11 misassigned rows. |
| `audit-staff-accounts.mjs` | **0** | 55 active staff. All 4 PMs Monday-ready: Brittney Werner = HEALTHY, Thomas Robinson = HEALTHY, Ben Wilson = PENDING_RESET (unexpired reset token → can log in via link), Chad Zeh = PENDING_RESET. Classification counts: 6 NO_PASSWORD, 25 INVITE_EXPIRED, 4 PENDING_RESET, 20 HEALTHY. INVITE_EXPIRED bucket is non-PM staff and not launch-blocking. |
| `reconcile-allocations.mjs` (dry-run) | **0** | **0 orphan allocations** across all three buckets: ghost-job (0), closed-job stuck (0), stale BACKORDERED (0). Post-Pulte-cleanup allocation hygiene is clean. |
| `dead-model-report.mjs` | **0** | 220 models scanned: 111 ZERO-row, 1 TABLE MISSING, 0 STALE, 108 ACTIVE. Top ZERO candidates: `CommunityNote`, `BuilderReferral`, `OrderTemplate`, `HomeownerAccess`, `HomeownerSelection`, `DecisionNote`, `JobPhase`, `OutreachSequence` (full list in `docs/DEAD-MODEL-REPORT.md`). Not launch-blocking; follow-up cleanup candidate. |

Full script output preserved in `/tmp/h2_*.log` during run.

---

## Section 2: Orphan FKs

| Check | Orphan count | Verdict | Action |
|---|---:|---|---|
| `Job.assignedPMId` → missing `Staff` | **0** | GREEN | — |
| `Job.assignedPMId` → `Staff.active=false` (active jobs only) | **20** | YELLOW | Re-assign to active PM per `verify-pm-assignments.mjs` fix SQL. Orphan-inactive PMs observed: Darlene Haag, Karen Johnson, Jessica Rodriguez, Scott Johnson, Robin Howell. 20 is the subset of 267 anomalies where the assigned-PM row is still on file but flagged inactive. |
| `PurchaseOrderItem.purchaseOrderId` → missing PO | **0** | GREEN | — |
| `InventoryAllocation.jobId` → missing Job | **0** | GREEN | — |
| `InventoryAllocation.productId` → missing Product | **0** | GREEN | — |
| `Invoice.builderId` → missing Builder | **22** | YELLOW | Investigate. Two deleted builder IDs (`cmmzruo7q029o93oppxwad5zs`, `cmmzrumbv028o93op5n6atwl8`) account for all 22. Amounts range from -$5,735.93 (negative, reversal?) to $726.22. Mix of DRAFT, PAID, OVERDUE. Not blocking, but AR reporting will behave oddly for these. |
| `Order.builderId` → missing Builder | **0** | GREEN | — |
| `Delivery.jobId` → missing Job | **0** | GREEN | — |
| `Task.jobId` → missing Job (where jobId set) | **0** | GREEN | — |
| `HyphenDocument.jobId` → missing Job (where jobId set) | **0** | GREEN | — |

### Top 3 samples — Invoice → missing Builder

| Invoice # | builderId (deleted) | Total | Status |
|---|---|---:|---|
| INV-2026-0001 | cmmzruo7q029o93oppxwad5zs | $3,888.60 | DRAFT |
| INV-2026-1017 | cmmzruo7q029o93oppxwad5zs | $726.22 | OVERDUE |
| INV-2026-1019 | cmmzrumbv028o93op5n6atwl8 | $421.96 | OVERDUE |

**Recommended action for Invoice→Builder orphans:** trace the two deleted builder IDs — if they were merged in a dedup pass (see `scripts/dedup-builders.mjs`), re-point the 22 invoices to the canonical Builder record via a single UPDATE. If they were legitimately removed, the invoices should also be voided or archived.

### Top 3 samples — Jobs on inactive PMs

| Job | Builder | Inactive PM |
|---|---|---|
| JOB-2026-1491 | Pulte Homes | Darlene Haag |
| JOB-2026-1540 | Pulte Homes | Darlene Haag |
| JOB-2026-1500 | Toll Brothers | Karen Johnson |

---

## Section 3: Population sanity

| Table | Count | Expected range | Verdict |
|---|---:|---|---|
| Staff (active=true) | 55 | ≥30 | GREEN |
| Job (total) | 3,999 | thousands | GREEN |
| Job (active; not CLOSED/INVOICED) | 627 | — | OK |
| Builder (total) | 170 | — | GREEN |
| Builder (status=ACTIVE) | 152 | ≥20 | GREEN |
| Order | 4,574 | thousands | GREEN |
| PurchaseOrder | 3,827 | thousands | GREEN |
| InventoryAllocation | 4,312 | thousands | GREEN |
| Product | 3,472 | thousands (InFlow catalog) | GREEN |
| InventoryItem | 3,076 | ~ Product count | YELLOW (396 products have no InventoryItem row; minor, not blocking) |
| Invoice | 4,124 | — | GREEN |
| Job.jobType populated | **0 / 3,999** | 0 expected right after migration | YELLOW — **needs backfill**, see Section 4 |

---

## Section 4: JobType schema drift

**Verified applied.** Migration `df8bafa` landed cleanly.

- `information_schema.columns` for `Job.jobType` returns `data_type=USER-DEFINED, udt_name=JobType`.
- `pg_enum` for `pg_type.typname='JobType'` returns all **14** labels in correct sortorder: `TRIM_1, TRIM_1_INSTALL, TRIM_2, TRIM_2_INSTALL, DOORS, DOOR_INSTALL, HARDWARE, HARDWARE_INSTALL, FINAL_FRONT, FINAL_FRONT_INSTALL, QC_WALK, PUNCH, WARRANTY, CUSTOM`.
- **100% of Jobs currently have `jobType=NULL`** (3999/3999). This is expected — the migration is additive only, and the backfill ticket is outstanding. The column is nullable, so this does not break any existing reads or writes.

---

## Section 5: Inconsistent-state hunts

| Check | Count | Verdict | Action |
|---|---:|---|---|
| CLOSED jobs with RESERVED InventoryAllocation | **0** | GREEN | — |
| COMPLETE/INVOICED/CLOSED jobs with BACKORDERED allocations | **0** | GREEN | — |
| PO status=RECEIVED with any line `receivedQty < quantity` | **3,527** | YELLOW | Likely legacy — POs imported from InFlow/Bolt were bulk-marked RECEIVED without receipt-line closeout. Short qty per PO is usually 1. See samples below. Not a Monday blocker; worth a cleanup ticket. |
| Invoice `amountPaid > total` | **4** | YELLOW | All 4 have **negative totals** (credit memos where `total=-$120, -$625, -$764, -$400` with `amountPaid=0`). The arithmetic anomaly is a sign-interpretation quirk, not actual overpayment. Review whether InvoiceStatus `PAID` is correct for these. |
| InventoryItem `committed > onHand` | **16** | YELLOW | Real over-commitment. SKU `BC000370` is 185 units over (committed=738, onHand=553). BC000728 has `onHand=0, committed=19`. This means 16 SKUs are flagged as reserved for jobs that can't actually ship. Needs a reservation rebuild post-Pulte-cleanup (allocation reconciliation is clean, so the over-commitment is on the InventoryItem.committed aggregate, not the individual allocations). |

### Samples — Inventory over-commitment

| SKU | onHand | committed | Over |
|---|---:|---:|---:|
| BC000370 | 553 | 738 | 185 |
| BC000203 | 289 | 429 | 140 |
| BC000204 | 37 | 176 | 139 |
| BC001675 | 105 | 199 | 94 |
| BC000470 | 136 | 181 | 45 |

---

## Section 6: Cron snapshot

**Zombies (RUNNING > 15 min): 0** — zombie-sweep cron is doing its job.

### Consecutive failures since last SUCCESS (≥3)

| Cron | Failures | Last success | Recommended action |
|---|---:|---|---|
| **bolt-sync** | 150 | never | **Disable or delete.** 150 consecutive failures with no success in DB history = dead cron. Likely a stale/legacy job from the ECI Bolt reconciliation phase. |
| **bpw-sync** | 150 | never | **Disable or delete.** Same pattern. Likely a stale Brookfield/Pulte sync from before the Hyphen pivot. |
| **gmail-sync** | 3 | 2026-04-24 18:45Z (45 min ago) | **Active P2.** Crashing on `brittney.werner@abellumber.com` with `ERROR: malformed array literal: "{"susan.daly@pulte.com","\"werner\",\"brittney.werner@abellumber.com\"}"`. Malformed Postgres text-array literal — double-quote escaping bug in `$executeRawUnsafe()`. Blocks the Gmail inbox pipeline. |
| **financial-snapshot** | 3 | never | 3 failures but only 3 runs total, no history of success. Investigate whether it has ever been deployed successfully. |

### Recent FAILED runs — last 24h (10 rows)

- 7× `gmail-sync`: mix of Brittney-Werner array-literal error and multiple Prisma `builder.findFirst` include errors (`organization`, `projects`, `orders` — likely stale include clause after schema change).
- 1× `inflow-sync`: `TIMEOUT: run never completed (swept by next run). Likely Vercel 300s kill.` — known long-poll edge case, benign if subsequent runs succeed.

---

## Section 7: Top rollups

### Top 10 builders by active (non-CLOSED, non-INVOICED) Jobs

| Builder | Active jobs |
|---|---:|
| Pulte Homes | **252** (all should be CLOSED per 9010d11 cleanup — ZOMBIE_LOST_BUILDER in Section 1) |
| Toll Brothers | 147 |
| Brookfield Homes | 80 |
| Imagination Homes | 37 |
| RDR Development | 24 |
| AGD Homes | 17 |
| Unknown | 13 |
| Brookson Builders | 8 |
| Villa-May Construction | 7 |
| Joseph Paul Homes | 6 |

### Top 10 vendors by open PO count (status NOT IN RECEIVED, CANCELLED)

| Vendor | Open POs |
|---|---:|
| Boise Cascade | 153 |
| Novo Building Products | 28 |
| METRIE | 17 |
| WOODGRAIN | 14 |
| WORLDWIDE | 7 |
| BlueLinx | 7 |
| HOELSCHER WEATHERSTIP MFG | 7 |
| ThermaTrue | 7 |
| Masonite | 7 |
| Banner Solutions | 5 |

### Last 5 Invoice.issuedAt

All 5 are dated **2026-03-23** (~1 month ago). No invoices have been issued since. This is the **last-billed cliff**: likely tied to the pre-seed cutover on 2026-04-13 (go-live). Either (a) no invoices have been generated since launch — which would be expected given many post-launch jobs haven't yet reached the INVOICED stage — or (b) invoice-generation cron is not actually running. **Worth confirming with Dawn.** Sample rows are all `PULTE-BWP-INV-*` PAID invoices on Brookfield jobs.

| Invoice # | issuedAt | Total | Status |
|---|---|---:|---|
| PULTE-BWP-INV-3276929-0000-0 | 2026-03-23 | $2,695.76 | PAID |
| PULTE-BWP-INV-3306242-0000-0 | 2026-03-23 | $1,272.57 | PAID |
| PULTE-BWP-INV-3306244-0000-0 | 2026-03-23 | $566.19 | PAID |
| PULTE-BWP-INV-3306504-0000-0 | 2026-03-23 | $1,203.32 | PAID |
| PULTE-BWP-INV-3306505-0000-0 | 2026-03-23 | $601.48 | PAID |

---

## Summary — drift still present from earlier reports

| Earlier report | Finding | Status today |
|---|---|---|
| D10 | 267 PM anomalies (11 misassigned, 252 Pulte zombies, 1 HWH, 188 UNKNOWN) | **UNCHANGED** — identical counts, identical row IDs for samples |
| D4 | 4 PMs healthy, 25 expired invites | **UNCHANGED** — same counts, 2 PMs now show PENDING_RESET rather than NEEDS_INVITE (reset tokens issued since D4) |

## Summary — new findings this sweep

1. 22 Invoices orphaned against 2 deleted Builder IDs — AR-reporting risk.
2. 2 dead legacy crons (`bolt-sync`, `bpw-sync`) still scheduled, 150 failures each.
3. `gmail-sync` actively crashing every 15 min on malformed-array-literal bug.
4. 16 SKUs over-committed in `InventoryItem` (allocations are clean — the drift is on the aggregate).
5. 3,527 POs sit in `status=RECEIVED` with line-item shortfalls (likely legacy from bulk import).
6. No invoices issued since 2026-03-23 — confirm with Dawn or check `generate-invoices` cron.
7. Backfill outstanding: 3,999 Jobs have `jobType=NULL` (schema migration is correct, just not populated).

## Exit status

Exit code: **0 (YELLOW — warnings only, no RED blockers)**.
