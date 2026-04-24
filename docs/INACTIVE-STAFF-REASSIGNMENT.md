# Inactive-Staff Job Reassignment

**Run:** 2026-04-24 — HEAD `6169e25` — read-only against Neon prod. No data or code modified.
**Source query:** `SELECT j.*, s.* FROM "Job" j JOIN "Staff" s ON s.id = j."assignedPMId" WHERE s.active = false AND j.status NOT IN ('CLOSED','INVOICED')`
**Cross-reference:** active `Staff` filtered by `role = 'PROJECT_MANAGER' AND active = true`.

---

## Summary

- **20 jobs** assigned to inactive staff are not yet `CLOSED` or `INVOICED`. All 20 are in status **`COMPLETE`** — work is done, awaiting invoice → close. None are in active production.
- **Status caveat for Nate's task brief:** the task's filter `NOT IN (COMPLETE, INVOICED, CLOSED, CANCELLED)` returns **0 jobs**, because every one of the 20 is `COMPLETE`. The 20-count comes from the audit's wider filter `NOT IN (CLOSED, INVOICED)`. Treat these as "post-completion ghosts" — invoicing/closing them and clearing the assignment is the cleanup, not active reassignment of in-flight work. (`CANCELLED` is also not a value in the `JobStatus` enum — see `prisma/schema.prisma` line 1123.)
- **Top inactive PMs by job count:** Scott Johnson (5), Darlene Haag (4), Jessica Rodriguez (4), Robin Howell (3), Jordan Sena (2), Karen Johnson (2).
- **Builder mix of the 20:** Pulte 10, Brookfield 4, Toll Brothers 3, Imagination 1, Joseph Paul 1, Royal Crest 1.
- **Notable:** Pulte account was **lost 2026-04-20** (per `CLAUDE.md` / `memory/customers/pulte.md`). The 10 Pulte ghosts here should arguably be CLOSED + assignment NULL'd in bulk (matches recommendation #3 in `AUDIT-DATA-REPORT.md`'s Pulte zombie cleanup), not reassigned.

### Recommendation table — high level

| PM (inactive) | # jobs | Recommended path |
|---|---:|---|
| Scott Johnson | 5 | Pulte rows (4): bulk-close per audit Pulte cleanup. Brookfield row (1): reassign to **Chad Zeh** (Brookfield-only book). |
| Darlene Haag | 4 | Reassign to **Darlene Haag (active record)** — see duplicate-staff note below — or to **Brittney Werner**. Pulte rows: bulk-close. |
| Jessica Rodriguez | 4 | Pulte rows (2): bulk-close. Toll Brothers + Royal Crest: reassign to **Ben Wilson** (general "other-builders" book). |
| Robin Howell | 3 | Pulte rows (2): bulk-close. Toll Brothers: reassign to **Ben Wilson**. |
| Jordan Sena | 2 | Both Brookfield: reassign to **Chad Zeh**. (Sena is `role = ADMIN`, not PM — assignments here are likely seed-data noise.) |
| Karen Johnson | 2 | Pulte: bulk-close. Toll Brothers: reassign to **Ben Wilson**. (Karen is `role = MANAGER`, not PM.) |

### Duplicate-staff flag (worth Nate's eye)

There are **two `Darlene Haag` Staff records**:
- **Inactive:** `cmn0sfkx000063v60tip1ic02` — owns the 4 ghost jobs above.
- **Active:** `stf_bolt_mn8wf46a_0p55` — currently has 0 active jobs but is on the active PM roster.

This looks like a Bolt-import vs. legacy-seed dupe. Same name, different IDs. Consolidating these (or at minimum re-pointing the 4 ghost-Darlene jobs to the active Darlene record) is the cleanest fix for that bucket. **Do not auto-merge without Nate's sign-off** — verify email/employeeId first.

Same shape may apply to other names but only Darlene shows duplicate name in the active-PM list.

---

## Inactive PMs and their jobs

### Scott Johnson — 5 jobs (`role = MANAGER`, inactive)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1485 | Brookfield Homes | Eagle Mountain | Eagle Mountain - Lot 8 | COMPLETE | 2026-01-30 | 2026-02-04 |
| JOB-2026-1488 | Pulte Homes | Heritage Hills | Heritage Hills - Lot 26 | COMPLETE | 2026-01-29 | 2026-02-01 |
| JOB-2026-1490 | Pulte Homes | Monarch Ranch | Monarch Ranch - Lot 49 | COMPLETE | 2026-01-28 | 2026-01-29 |
| JOB-2026-1516 | Pulte Homes | Copper Canyon | 14069 Ladbroke St. | COMPLETE | 2026-01-16 | 2026-01-21 |
| JOB-2026-1533 | Brookfield Homes | Lone Star Ranch | 15503 Swallowtail | COMPLETE | 2026-01-09 | 2026-01-14 |

**Suggested reassignment:**
- Brookfield jobs (1485, 1533) → **Chad Zeh** — Chad's active book is 76 Brookfield jobs, near-100% Brookfield specialization.
- Pulte jobs (1488, 1490, 1516) → close per Pulte zombie cleanup in `AUDIT-DATA-REPORT.md` step 2/3 (account lost; no PM ownership needed for COMPLETE rows).

---

### Darlene Haag — 4 jobs (`role = PROJECT_MANAGER`, inactive — but a separate active "Darlene Haag" PM exists)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1474 | Imagination Homes | Heritage Hills | Heritage Hills - Lot 9 | COMPLETE | 2026-02-05 | 2026-02-08 |
| JOB-2026-1480 | Joseph Paul Homes | Whispering Oaks | 1450 Todd -- Crown Mould | COMPLETE | 2026-02-03 | 2026-02-06 |
| JOB-2026-1491 | Pulte Homes | Eagle Mountain | 424 Avian | COMPLETE | 2026-01-28 | 2026-01-29 |
| JOB-2026-1540 | Pulte Homes | Iron Horse | 1817 Village Creek Lane | COMPLETE | 2026-01-06 | 2026-01-07 |

**Suggested reassignment:**
- All 4 → **Darlene Haag (active record `stf_bolt_mn8wf46a_0p55`)** — assuming this is the same person and the inactive record is a stale legacy/seed dupe. Pending Nate's confirmation of identity (check email + employeeId). If they're not the same person, fall back to **Brittney Werner** for the Pulte rows (her Pulte specialty) and **Ben Wilson** for Imagination + Joseph Paul (general other-builder bucket).
- Alternative: Pulte rows close per Pulte cleanup; Imagination + Joseph Paul → Ben Wilson.

---

### Jessica Rodriguez — 4 jobs (`role = PROJECT_MANAGER`, inactive)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1472 | Pulte Homes | Whispering Oaks | 8705 Leafy Lane | COMPLETE | 2026-02-05 | 2026-02-09 |
| JOB-2026-1495 | Toll Brothers | Oak Creek | 1512 Canter Street | COMPLETE | 2026-01-27 | 2026-01-30 |
| JOB-2026-1528 | Royal Crest Homes | Whispering Oaks | 5848 Boat Club Rd St 400 | COMPLETE | 2026-01-13 | 2026-01-17 |
| JOB-2026-1543 | Pulte Homes | Eagle Mountain | 432 Avian Way | COMPLETE | 2026-01-05 | 2026-01-09 |

**Suggested reassignment:**
- Toll Brothers (1495), Royal Crest (1528) → **Ben Wilson** — has the largest non-Brookfield non-Pulte active book (61 jobs, all "other"), so these fit his existing portfolio.
- Pulte (1472, 1543) → close per Pulte cleanup.

---

### Robin Howell — 3 jobs (`role = PROJECT_MANAGER`, inactive)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1467 | Pulte Homes | Oak Creek | 468 Avian EPO | COMPLETE | 2026-02-06 | 2026-02-11 |
| JOB-2026-1497 | Toll Brothers | Stone Bridge | Stone Bridge - Lot 15 | COMPLETE | 2026-01-26 | 2026-01-27 |
| JOB-2026-1541 | Pulte Homes | Wildflower Estates | 14058 Kempt Dr. | COMPLETE | 2026-01-06 | 2026-01-10 |

**Suggested reassignment:**
- Toll Brothers (1497) → **Ben Wilson**.
- Pulte (1467, 1541) → close per Pulte cleanup.

---

### Jordan Sena — 2 jobs (`role = ADMIN`, inactive — not a PM by role)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1479 | Brookfield Homes | Whispering Oaks | Whispering Oaks - Lot 25 | COMPLETE | 2026-02-03 | 2026-02-07 |
| JOB-2026-1517 | Brookfield Homes | Sienna Hills | Sienna Hills - Lot 22 | COMPLETE | 2026-01-15 | 2026-01-20 |

**Suggested reassignment:**
- Both → **Chad Zeh** (Brookfield specialist).
- Note: Sena's primary role is ADMIN, not PM. These assignments are likely seed-data noise from the Bolt import — worth checking if Sena ever actually managed jobs, or if these should have been Chad/Brittney from day one.

---

### Karen Johnson — 2 jobs (`role = MANAGER`, inactive — not a PM by role)

| Job # | Builder | Community | Address | Status | Scheduled | Completed |
|---|---|---|---|---|---|---|
| JOB-2026-1494 | Pulte Homes | Lone Star Ranch | 2728 Barton Springs EPO Thresholds | COMPLETE | 2026-01-27 | 2026-01-29 |
| JOB-2026-1500 | Toll Brothers | Heritage Hills | 1421 Magnolia | COMPLETE | 2026-01-26 | 2026-01-31 |

**Suggested reassignment:**
- Toll Brothers (1500) → **Ben Wilson**.
- Pulte (1494) → close per Pulte cleanup.
- Same role-mismatch flag as Sena: Karen is MANAGER, not PROJECT_MANAGER. Likely seed-data assignment that was never accurate.

---

## Active PM capacity (current load)

Counts are **active jobs only** (`status NOT IN ('COMPLETE','INVOICED','CLOSED','CANCELLED')`). Excludes the 20 ghost rows above.

| PM | Active jobs | Pulte | Brookfield | Bloomfield | Other |
|---|---:|---:|---:|---:|---:|
| Brittney Werner | 149 | 6 | 0 | 0 | 143 |
| Chad Zeh | 81 | 0 | 76 | 0 | 5 |
| Ben Wilson | 61 | 0 | 0 | 0 | 61 |
| Thomas Robinson | 43 | 0 | 0 | 0 | 43 |
| Darlene Haag (active record) | 0 | 0 | 0 | 0 | 0 |
| Matthew Sams | 0 | 0 | 0 | 0 | 0 |
| Dalton Whatley | 0 | 0 | 0 | 0 | 0 |
| Abel Success AI | 0 | 0 | 0 | 0 | 0 |

**Reading the table:**
- **Brittney Werner** carries the bulk of the active book (149) — most "other" volume. She's the right home for any Pulte-recovery work if Pulte ever comes back, but capacity-wise she's already loaded.
- **Chad Zeh** is the Brookfield specialist (76 / 81 of his book). All ghost-Brookfield rows above (3 total: Scott × 2, Sena × 2 — wait, Scott × 1 + Sena × 2 = 3) should consolidate to him.
- **Ben Wilson** + **Thomas Robinson** are the "other small builders" benches (Toll, Imagination, Joseph Paul, Royal Crest, etc.). Ben has more bandwidth at 61 vs Thomas at 43 — probably where Toll/Royal Crest/Imagination/Joseph Paul reassignments land first.
- **Bloomfield is 0 across the entire active book** — despite being called out as an active account in `CLAUDE.md`. That's worth a separate look (out of scope here, but flagging).
- **Darlene Haag (active), Matthew Sams, Dalton Whatley, Abel Success AI** all carry zero active jobs. The active-Darlene zero count is consistent with the "duplicate staff record" hypothesis above.

---

## What this doc deliberately does NOT do

- **Does not modify any data.** No `UPDATE`, `DELETE`, or schema migration written or applied.
- **Does not modify any source code.** Only deliverable is this `.md`.
- **Does not act on duplicate-Darlene merge.** Verifying identity (email, employeeId, Bolt linkage) is Nate's call.
- **Does not auto-close Pulte rows.** That's covered by `AUDIT-DATA-REPORT.md` § "252 Pulte zombies — recommended cleanup SQL" and needs separate Nate sign-off.

---

## Next steps for Nate (decisions)

1. **Confirm or reject the Darlene-Haag duplicate hypothesis.** If same person → repoint 4 jobs to active record. If different → use the fallback assignment plan.
2. **Approve Pulte bulk-close** for the 10 ghost-Pulte rows (per audit step 2/3). This eliminates roughly half of the 20 in one move.
3. **Approve Brookfield reassignment** of the remaining ~3 ghost-Brookfield rows → Chad Zeh.
4. **Approve "other" reassignment** of the remaining ~5 ghost rows (Toll Brothers, Imagination, Joseph Paul, Royal Crest) → Ben Wilson.
5. (Optional) Decide on the role-mismatch records (Sena=ADMIN, K. Johnson=MANAGER, S. Johnson=MANAGER) — should non-PM staff ever own jobs in this system? If no, add a constraint.
