# Monday Launch Readiness — 2026-04-23

**HEAD:** `74f6bbd` — `fix(build): drop THOMAS_BUILDER_PATTERNS page export`
**Agent:** H6 (read-only, file-presence + code-trace + live-DB probe)
**Launch target:** Mon 2026-04-27 — 4 PMs (Chad, Brittney, Ben, Thomas) + Dawn + Nate

---

## TL;DR

**CONDITIONAL GO.** All 12 journey code paths ship and route correctly; all 4 PMs have real books with real active jobs (43-286 each) and live passwordHash-backed logins. **But two data gaps will hurt the demo**: (a) zero jobs have a `scheduledDate` beyond today 2026-04-23, so the Calendar and Today view will be empty come Monday, and (b) Hyphen document ingestion table is empty (0 docs) so no close chips render either. Fixable in SQL before Monday — flagged below.

---

## Per-journey scorecard

| # | Journey | Files | DB data | Verdict | Notes |
|---|---|---|---|---|---|
| 1 | PM login → my-book | ok | 4/4 PMs have books (286/43/61/81 active) | **PASS** | Middleware whitelists /ops/login; login route accepts POST; my-book redirects `/ops/pm/book/[staffId]` |
| 2 | Today view | ok | Brittney today/tomorrow/week = 0 | **WARN** | Today page + API present. But scheduled dates are all stale (see Calendar). Banner handles empty state. |
| 3 | Calendar | ok (all 4 filters present) | **0 jobs scheduled in next 30 days** | **WARN** | Will look EMPTY on Monday. No Hyphen close events either. See Findings #1. |
| 4 | Job drill-down | ok | 319/627 active jobs have InventoryAllocation rows | **PASS** | HyphenPanel + MaterialDrawer + ChangeOrderInbox + DeliverySignOff all imported on page.tsx |
| 5 | Collections (Dawn) | ok | Top exposure = Hayhurst Bros ($525K score), NOT Brookfield | **PASS** | Exposure API works. Amanda/Brookfield hypothesis wrong — Brookfield AR is only $2,175. See Findings #2. |
| 6 | Substitution approval | ok | 0 PENDING; table auto-created on first call via `ensureSubstitutionRequestTable()` | **PASS (empty)** | Nothing to demo Monday — flag if Nate wants to seed one. |
| 7 | Activity feed | ok | 639 rows last 24h, 651 last 7d | **PASS** | Rich. |
| 8 | PM compare + roster | ok | 8 active PROJECT_MANAGER staff (not just the 4) | **PASS** | |
| 9 | Scan / QC | ok | ANTHROPIC_API_KEY not in .env | **WARN** | Claude Vision scan-sheet will return 503 until Nate sets `ANTHROPIC_API_KEY` in Vercel. |
| 10 | Builder account | ok (`sections/` present with AROverview, ContactCard, OpenJobsSection, BuilderDetailClient) | Brookfield: 80 open jobs, $2,175 open AR, 3 open invoices | **PASS** | |
| 11 | SmartPO queue | ok | 532 PENDING | **PASS (with permissions gap)** | Dalton/PURCHASING will be DENIED — `/ops/smartpo` has **no entry** in `ROUTE_ACCESS` or `API_ACCESS`; default-deny hits non-ADMIN. Existing entries are for old `/ops/purchasing/smart-po`. See Findings #3. |
| 12 | Shortages viewer | ok | 778 DemandForecast rows in next 14d | **PASS** | Volume will be inflated by labor/services SKUs per Nate's note. |

---

## Cross-cutting checks

| Check | Result |
|---|---|
| All 4 PMs active with passwordHash set | **PASS** — Chad, Brittney, Ben, Thomas all `active=true`, `role=PROJECT_MANAGER`, `roles='PROJECT_MANAGER'`, hash > 20 chars |
| JWT_SECRET present in .env | **PASS** |
| CRON_SECRET present in .env | **MISSING** — cron routes that require it will 401 |
| ANTHROPIC_API_KEY present in .env | **MISSING** — Claude Vision scan-sheet returns 503 |
| NEXT_PUBLIC_APP_URL | `https://abel-builder-platform.vercel.app` in local .env. Prod Vercel env presumably has `https://app.abellumber.com` — verify in Vercel dashboard, don't trust local copy. |
| Middleware public allowlist | `/ops/login` + `/ops/forgot-password` + `/ops/reset-password` + `/ops/setup-account` — correct |
| Middleware forces JWT_SECRET in prod | **YES** — throws on startup if NODE_ENV=production and not set |

---

## Key findings

### 1. (WARN, NOT BLOCKING) Calendar + Today will look empty Monday

- Every active job (367 rows across CREATED → PUNCH_LIST) has `scheduledDate` set, but the **latest** scheduledDate in the table is **2026-04-23** (today). Zero jobs scheduled for May 2026 or beyond.
- `/ops/today` queries jobs for Brittney scheduled today/tomorrow/this week → gets 0 / 0 / 0.
- `/ops/calendar` grid query for next 30 days → 0 jobs returned.
- Secondary fallback: close events come from HyphenDocument.closingDate — table has **0 rows total**. No close chips either.
- **Demo impact**: PMs will see empty dashboards. The empty-state UI is well designed, but Nate should either (a) backfill near-future `scheduledDate` on a realistic subset (e.g., push 50 active jobs to 2026-04-28 through 2026-05-08) before Monday, or (b) explicitly coach the PMs that scheduling is their first Monday task.

### 2. (INFO) Top AR exposure is Hayhurst Bros Builders, not Brookfield

- User's task assumed Amanda Barham / Brookfield would be the top-exposure surface. In fact the `balance × daysPastDue` ranking is:
  1. Hayhurst Bros Builders — $9,043, 77d max past due, score 525,671
  2. RDR Development — $7,372, 82d, 436,592
  3. Pulte Homes — $7,279, 62d, 413,306
  4. Brad Eugster — $5,584, 56d, 315,862
  5. Imagination Homes — $3,634, 220,871
- Brookfield Homes has $2,175.47 across 3 invoices — low exposure (Brookfield pays).
- The code logic works correctly (see `src/app/api/ops/collections/exposure/route.ts`); the assumption in the task was off. Dawn's cockpit will surface Hayhurst, which is the right answer.

### 3. (ACTION REQUIRED) `/ops/smartpo` will be ADMIN-only on Monday

- `src/lib/permissions.ts` has entries for the OLD path `/ops/purchasing/smart-po` (line 177), but **no entry for the new `/ops/smartpo`** that 532 PENDING recs are living on.
- Default behavior in `canAccessRoute()` and `canAccessAPI()` when no ROUTE_ACCESS match: return false → deny. So Dalton (PURCHASING role), Clint (MANAGER), and anyone else non-ADMIN will get bounced from `/ops/smartpo` and `/api/ops/smartpo/*`.
- 2-line fix in `permissions.ts`:
  ```
  '/ops/smartpo':        ['ADMIN', 'MANAGER', 'PURCHASING'],
  '/api/ops/smartpo':    ['ADMIN', 'MANAGER', 'PURCHASING'],
  ```

### 4. (INFO) 9 orphan invoices pointing to missing Builder rows

- 9 Invoice rows with `status IN (ISSUED, SENT, PARTIALLY_PAID, OVERDUE)` have `builderId` values that don't resolve to any Builder row (totaling ~$35K balance). The exposure query surfaces these as `builderId=null, companyName=null`.
- Collections page renders these as a broken row (null name) — Dawn will see something like an unlabeled entry. Not a blocker, but will look sloppy. Backfill or hide via a `WHERE b.id IS NOT NULL` clause before Monday.

### 5. (PASS) Auth foundation is solid

- `/ops/login` + `/api/ops/auth/login` both present and wire to `staff-auth.ts` verifyPassword + createStaffToken.
- Middleware JWT verification enforced for all `/ops/*` and `/api/ops/*` except public routes.
- CSRF check on mutations via Origin header.
- StaffRoles multi-role join works (login route queries it) with graceful fallback.
- All 4 launch PMs have valid bcrypt hashes — they can log in.

### 6. (PASS) Job drill-down is comprehensively wired

- `/ops/jobs/[jobId]/page.tsx` imports and renders: DocumentPanel, PresenceAvatars, HyphenDocumentsTab, HyphenPanel, AllocationPanel, MaterialConfirmBanner, MaterialDrawer, CoPreviewSheet, ChangeOrderInbox, DeliverySignOff.
- All 4 feature flags default to ON (only `=off` disables).
- 319 of 627 non-closed jobs have ≥1 InventoryAllocation → MaterialDrawer will render real data for ~51% of active jobs.

### 7. (PASS) Substitution approval path is complete

- `/ops/substitutions/page.tsx` + SubstitutionQueue.tsx + `/ops/substitutions/requests/page.tsx` all present.
- `/api/ops/substitutions/route.ts` (list), `/requests/[id]/approve/route.ts`, `/requests/[id]/reject/route.ts` all present.
- The `SubstitutionRequest` table isn't in `prisma/schema.prisma` but is auto-created via `ensureSubstitutionRequestTable()` in `src/lib/substitution-requests.ts`. Currently 0 rows (table likely doesn't exist until first call).

### 8. (PASS) Scan / QC / Job Packet

- `/ops/scan/page.tsx` present. `/api/ops/scan-sheet/route.ts` reads `process.env.ANTHROPIC_API_KEY` (line 49) and returns 503 if missing.
- `/ops/manufacturing/job-packet/page.tsx` has both "QC SIGN-OFF" (line 560) and "QC / PUNCH WALK SHEET" (line 733) sections.

---

## Specific actions Nate must take before Monday

1. **Set `ANTHROPIC_API_KEY` in Vercel production env.** Without it, the scan flow returns 503. Rotate/pull from 1Password if needed.
2. **Verify `CRON_SECRET` is set in Vercel production.** Local .env doesn't have it — cron routes will reject Vercel's scheduled hits.
3. **Patch `src/lib/permissions.ts` for `/ops/smartpo`.** Add the 2 lines shown in Findings #3 so Dalton (PURCHASING) can actually work the queue Monday. Otherwise SmartPO is ADMIN-only.
4. **Confirm `NEXT_PUBLIC_APP_URL=https://app.abellumber.com` in Vercel prod.** Local .env has the vercel.app fallback — that's OK for local dev but must be correct in production env.
5. **Reschedule a realistic subset of active jobs to next week** OR tell PMs explicitly that their Monday job is to set `scheduledDate`. Currently 0 jobs scheduled beyond 2026-04-23. Calendar, Today, and week-ahead views will be empty. Suggestion: SQL update that pushes 30-50 `CREATED`/`READINESS_CHECK`/`MATERIALS_LOCKED` jobs to dates between 2026-04-28 and 2026-05-09, weighted toward Brittney (her book is 286 jobs).
6. **(optional, cosmetic)** Clean up 9 orphan Invoices with dangling `builderId` before Dawn sees them in Collections. Quick SQL: find and either relink or soft-hide.
7. **(optional)** Seed 1 PENDING `SubstitutionRequest` row if Nate wants a substitution-approval demo Monday.

---

## Journey-to-file trace (for Nate's reference)

### Files verified present
- `src/app/ops/login/page.tsx` + `src/app/api/ops/auth/login/route.ts`
- `src/middleware.ts` (line 40: `opsPublicRoutes` includes `/ops/login`)
- `src/app/ops/my-book/page.tsx` (reads `x-staff-id`, redirects `/ops/pm/book/${staffId}`)
- `src/app/ops/pm/book/[staffId]/page.tsx` + `src/app/api/ops/pm/book/[staffId]/route.ts`
- `src/app/ops/today/page.tsx` + `src/app/api/ops/pm/today/route.ts`
- `src/app/ops/calendar/page.tsx` + CalendarGrid.tsx (PM/Builder/JobType/hideClosed filters all present lines 118-218) + `src/app/api/ops/calendar/jobs/route.ts`
- `src/app/ops/jobs/[jobId]/page.tsx` (HyphenPanel, MaterialDrawer, ChangeOrderInbox, DeliverySignOff all imported lines 9-15)
- `src/app/ops/collections/page.tsx` + `src/app/api/ops/collections/send-reminder/route.ts` + `src/app/api/ops/collections/exposure/route.ts`
- `src/app/ops/substitutions/page.tsx` + `src/app/api/ops/substitutions/route.ts` + `/requests/[id]/approve/route.ts`
- `src/app/ops/pm/activity/page.tsx` + `src/app/api/ops/pm/activity/route.ts`
- `src/app/ops/pm/compare/page.tsx` + `src/app/ops/pm/page.tsx` + `src/app/api/ops/pm/roster/route.ts`
- `src/app/ops/scan/page.tsx` + `src/app/api/ops/scan-sheet/route.ts` (line 49 reads ANTHROPIC_API_KEY)
- `src/app/ops/manufacturing/job-packet/page.tsx`
- `src/app/admin/builders/[id]/page.tsx` + `sections/` (AROverview, BuilderDetailClient, ContactCard, OpenJobsSection)
- `src/app/ops/smartpo/page.tsx` + `src/app/api/ops/smartpo/recommendations/route.ts` + `/ship/route.ts`
- `src/app/ops/shortages/page.tsx` + `src/app/api/ops/shortages/route.ts`

### Files NOT present but expected in task
- None. All 12 journey file-list checks passed.

---

## Live DB snapshot (as of 2026-04-23)

- Staff: Chad Zeh `stf_bolt_mn8wg7lv_fle1`, Brittney Werner `stf_bolt_mn8wg5u3_krwl`, Ben Wilson `stf_bolt_mn8wf3de_l0xy`, Thomas Robinson `stf_bolt_mn8wf5kf_pr0l`
- Active jobs per PM (status NOT IN CLOSED,INVOICED): Brittney 286, Chad 81, Ben 61, Thomas 43
- Active PMs total (role=PROJECT_MANAGER): 8
- AuditLog: 639 / 651 / 657 (last 24h / 7d / all-time)
- InventoryAllocations with coverage: 319/627 active jobs have ≥1 allocation row
- SmartPO PENDING: 532 recs
- DemandForecast next 14d: 778 rows (inflated by labor/services per known issue)
- Brookfield: 80 open jobs, $2,175.47 open AR (3 invoices)
- Brookfield is NOT the top-exposure builder; Hayhurst Bros is.
- HyphenDocument: 0 rows total — no close events will render on Calendar
