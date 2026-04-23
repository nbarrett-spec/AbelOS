# PM Orphan Close-Out Report

**Mode:** APPLY (writes executed)
**Run at:** 2026-04-23T03:52:43.429Z

## Before

- Orphan Jobs (`assignedPMId IS NULL`): **95**

## Classification

| Bucket | Count | Action |
|---|---:|---|
| CLOSED_ARCHIVED | 95 | Leave null (archival state, no PM needed) |
| STALE | 0 | Leave null, flag for manual archive (see list below). **Note:** CANCELLED is not in the JobStatus enum — can't auto-flip. |
| ACTIVE_NEEDS_PM | 0 | Assigned via load-balanced round-robin |
| EDGE_CASE | 0 | Logged for manual review |

**Total:** 95

## After

- Orphan Jobs remaining (`assignedPMId IS NULL`): **95**
- Expected remaining = CLOSED_ARCHIVED + STALE + EDGE_CASE = 95

## Per-PM load (after this run)

| PM | Before | Added (this run) | After |
|---|---:|---:|---:|
| Chad Zeh | 118 | 0 | 118 |
| Brittney Werner | 118 | 0 | 118 |
| Thomas Robinson | 118 | 0 | 118 |
| Ben Wilson | 117 | 0 | 117 |
| Jessica Rodriguez | 55 | 0 | 55 |
| Sean Phillips | 55 | 0 | 55 |
| Robin Howell | 44 | 0 | 44 |
| Jordan Sena | 63 | 0 | 63 |
| Scott Johnson | 52 | 0 | 52 |
| Karen Johnson | 40 | 0 | 40 |
| Darlene Haag | 55 | 0 | 55 |
| Nathaniel Barrett | 52 | 0 | 52 |
| Clint Vinson | 34 | 0 | 34 |

## STALE jobs (pre-ship status, no activity in 180+ days)

These were left unassigned. Recommend Nate/PMs archive manually (there is no CANCELLED enum value, so status can't be flipped automatically today).

_None._

## EDGE_CASE jobs (status outside known active/closed sets)

_None._

## CLOSED_ARCHIVED jobs (status in CLOSED/COMPLETE/INVOICED/CANCELLED)

No action taken — archival state, PM not required.

| Job # | Status | Builder | Updated |
|---|---|---|---|
| `7815-00217` | COMPLETE | Pulte | 2026-04-09 |
| `7815-01216` | COMPLETE | Pulte | 2026-04-09 |
| `7816-00114` | COMPLETE | Pulte | 2026-04-09 |
| `7816-00322` | COMPLETE | Pulte | 2026-04-09 |
| `7816-00623` | COMPLETE | Pulte | 2026-04-09 |
| `7635-00115` | COMPLETE | Pulte | 2026-04-09 |
| `7635-02716` | COMPLETE | Pulte | 2026-04-09 |
| `7635-02816` | COMPLETE | Pulte | 2026-04-09 |
| `7635-02916` | COMPLETE | Pulte | 2026-04-09 |
| `7636-01110` | COMPLETE | Pulte | 2026-04-09 |
| `7636-02211` | COMPLETE | Pulte | 2026-04-09 |
| `7636-03711` | COMPLETE | Pulte | 2026-04-09 |
| `8468-00607` | COMPLETE | Pulte | 2026-04-09 |
| `8468-00807` | COMPLETE | Pulte | 2026-04-09 |
| `8468-02306` | COMPLETE | Pulte | 2026-04-09 |
| `8468-02606` | COMPLETE | Pulte | 2026-04-09 |
| `8469-01209` | COMPLETE | Pulte | 2026-04-09 |
| `8469-01309` | COMPLETE | Pulte | 2026-04-09 |
| `9443-00109` | COMPLETE | Pulte | 2026-04-09 |
| `9443-00309` | COMPLETE | Pulte | 2026-04-09 |
| `9443-00509` | COMPLETE | Pulte | 2026-04-09 |
| `9443-00609` | COMPLETE | Pulte | 2026-04-09 |
| `9443-04108` | COMPLETE | Pulte | 2026-04-09 |
| `9443-04208` | COMPLETE | Pulte | 2026-04-09 |
| `9443-04408` | COMPLETE | Pulte | 2026-04-09 |
| `9444-00709` | COMPLETE | Pulte | 2026-04-09 |
| `9444-04308` | COMPLETE | Pulte | 2026-04-09 |
| `8823-02633` | COMPLETE | Pulte | 2026-04-09 |
| `8822-01824` | COMPLETE | Pulte | 2026-04-09 |
| `6746-11210` | COMPLETE | Pulte | 2026-04-09 |
| `6746-11513` | COMPLETE | Pulte | 2026-04-09 |
| `6746-11613` | COMPLETE | Pulte | 2026-04-09 |
| `6746-11713` | COMPLETE | Pulte | 2026-04-09 |
| `6746-12110` | COMPLETE | Pulte | 2026-04-09 |
| `5305-00126` | COMPLETE | Pulte | 2026-04-09 |
| `5305-00225` | COMPLETE | Pulte | 2026-04-09 |
| `5305-00226` | COMPLETE | Pulte | 2026-04-09 |
| `5305-02716` | COMPLETE | Pulte | 2026-04-09 |
| `5305-02816` | COMPLETE | Pulte | 2026-04-09 |
| `8143-01605` | COMPLETE | Pulte | 2026-04-09 |
| `8144-00909` | COMPLETE | Pulte | 2026-04-09 |
| `8144-04102` | COMPLETE | Pulte | 2026-04-09 |
| `8148-01302` | COMPLETE | Pulte | 2026-04-09 |
| `8149-02901` | COMPLETE | Pulte | 2026-04-09 |
| `7701-01021` | COMPLETE | Pulte | 2026-04-09 |
| `7701-03021` | COMPLETE | Pulte | 2026-04-11 |
| `7701-08021` | COMPLETE | Pulte | 2026-04-09 |
| `7701-27021` | COMPLETE | Pulte | 2026-04-09 |
| `7702-10014` | COMPLETE | Pulte | 2026-04-09 |
| `7702-17016` | COMPLETE | Pulte | 2026-04-11 |
| _…45 more_ | | | |

## ACTIVE_NEEDS_PM assignments

_None._

## Notes

- The JobStatus enum does **not** contain `CANCELLED`. The mission asked to flip STALE jobs to CANCELLED, but doing so would fail the Prisma write. Leaving STALE jobs unassigned is the safer option and is documented above.
- Load-balanced assignment picks the PM with the lowest current total (existing + already-picked-in-this-run). Tie-break is by staff id so re-runs stay deterministic.
- The script is idempotent: once run with `--apply`, ACTIVE_NEEDS_PM drops to zero on the next run.