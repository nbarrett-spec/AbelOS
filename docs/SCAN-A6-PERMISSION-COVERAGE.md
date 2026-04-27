# SCAN-A6 — Permission Coverage

**HEAD:** 171a6b4
**Mode:** READ-ONLY (no commits)
**tsc:** clean

## Method

770 route handlers total; 515 under `/api/ops`. Loaded `API_ACCESS` (95 prefix entries) and `canAccessAPI()` longest-prefix logic from `src/lib/permissions.ts`. For each `/api/ops/*` handler: does it call `checkStaffAuth*` / `requireStaffAuth` (which auto-runs `canAccessAPI`)? If yes — does its path resolve to an `API_ACCESS` prefix (Pile A) or fall through to default-deny (Pile B)? If no auth helper at all, what does it use — bearer webhook, `requireDevAdmin`, inline header check, or nothing (Pile C)? UI fetch sites under `src/app/ops/` and `src/app/sales/` cross-referenced.

Middleware validates the staff JWT cookie at the edge for `/api/ops/*` and 401s on missing/invalid cookie. It does **not** run role checks — that's the handler's job.

## Pile A — Covered correctly (360)

Sample of the 360 routes that have both an API_ACCESS entry and a staff-auth helper:

- `/api/ops/jobs/[id]/tasks` → matches `/api/ops/jobs` (PM/ESTIMATOR/SALES/WAREHOUSE_LEAD)
- `/api/ops/sales/deals/[id]/activities/[activityId]` → matches `/api/ops/sales`
- `/api/ops/tasks/[id]/complete` → matches `/api/ops/tasks` (broad allowlist, all staff)
- `/api/ops/trim-vendors` and `/api/ops/trim-vendors/[id]` → match `/api/ops/trim-vendors` (ADMIN/MANAGER/PURCHASING)
- `/api/ops/portal/pm/material` → matches own explicit prefix (ADMIN/MANAGER/PROJECT_MANAGER)

The 4 special-check routes from the brief all resolve correctly via longest-prefix match.

## Pile B — Default-deny holes (104, P0/P1)

These routes call `checkStaffAuth()` which always runs `canAccessAPI()`. Because none of their paths resolve to any `API_ACCESS` prefix, `sortedRoutes` is empty in `canAccessAPI` → falls through to `return false` → every non-ADMIN gets a silent 403.

### P0 — UI-bound, actively breaking pages today

#### `/api/ops/dashboard`
**Handler:** `src/app/api/ops/dashboard/route.ts`
**Used by:** `src/app/ops/page.tsx` (the main `/ops` landing page that everyone sees)
**Recommended allowlist:** `ALL_ROLES`
**Why:** Top-of-app dashboard counts. If non-admin can reach `/ops`, they need this feed.

#### `/api/ops/me`
**Handler:** `src/app/api/ops/me/route.ts`
**Used by:** Sidebar / nav across every ops page (returns logged-in staff identity)
**Recommended allowlist:** `ALL_ROLES`
**Why:** Self-identity lookup. Should never 403.

#### `/api/ops/search`
**Handler:** `src/app/api/ops/search/route.ts`
**Used by:** `src/app/ops/components/GlobalSearch.tsx` (Cmd-K/global search bar)
**Recommended allowlist:** `ALL_ROLES`
**Why:** Global search bar is on every page.

#### `/api/ops/contacts`
**Handler:** `src/app/api/ops/contacts/route.ts`
**Used by:** Account detail pages, builder pages
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR, SALES_REP, ACCOUNTING`
**Why:** Office-level address book; mirrors `/api/ops/accounts` allowlist.

#### `/api/ops/contracts`
**Handler:** `src/app/api/ops/contracts/route.ts`
**Used by:** `src/app/ops/contracts/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, SALES_REP, ESTIMATOR`
**Why:** Mirrors page-level rule for `/ops/contracts`.

#### `/api/ops/calendar/jobs`
**Handler:** `src/app/api/ops/calendar/jobs/route.ts`
**Used by:** `src/app/ops/calendar/CalendarGrid.tsx`, `src/app/ops/calendar/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR, SALES_REP, WAREHOUSE_LEAD, DRIVER`
**Why:** Job calendar consumed by PMs, schedulers, and dispatch.

#### `/api/ops/builder-messages`
**Handler:** `src/app/api/ops/builder-messages/route.ts`
**Used by:** `src/app/ops/builder-messages/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, SALES_REP`
**Why:** Mirrors page-level `/ops/builder-messages` rule already in `ROUTE_ACCESS`.

#### `/api/ops/credit-alerts`
**Handler:** `src/app/api/ops/credit-alerts/route.ts`
**Used by:** Finance/AR widgets and builder-health pages
**Recommended allowlist:** `ADMIN, MANAGER, ACCOUNTING, PROJECT_MANAGER, SALES_REP`
**Why:** Mirrors `/api/ops/finance/ar` audience.

#### `/api/ops/customers/health`
**Handler:** `src/app/api/ops/customers/health/route.ts`
**Used by:** `src/app/ops/customers/health/page.tsx` (builder health scorecard)
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, SALES_REP, ACCOUNTING`
**Why:** Same audience as `/ops/builder-health`.

#### `/api/ops/locations`
**Handler:** `src/app/api/ops/locations/route.ts`
**Used by:** `src/app/ops/locations/page.tsx` + dropdowns
**Recommended allowlist:** `ALL_ROLES` (read), with mutations gated server-side to ADMIN/MANAGER
**Why:** Locations show up in many dropdowns; page-level rule is ADMIN/MANAGER but read needs to be wider.

#### `/api/ops/trades` and `/api/ops/trades/[id]/reviews`
**Handler:** `src/app/api/ops/trades/route.ts`, `[id]/reviews/route.ts`
**Used by:** `src/app/ops/trades/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, SALES_REP, INSTALLER`
**Why:** Mirrors `/ops/trades` page rule.

#### `/api/ops/takeoff-inquiries`
**Handler:** `src/app/api/ops/takeoff-inquiries/route.ts`
**Used by:** `src/app/ops/takeoff-inquiries/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR`
**Why:** Mirrors `/ops/takeoff-inquiries` page rule.

#### `/api/ops/my-day`
**Handler:** `src/app/api/ops/my-day/route.ts`
**Used by:** `src/app/ops/my-day/page.tsx` and the "today" briefing widgets
**Recommended allowlist:** `ALL_ROLES`
**Why:** Personal dashboard for every staff member.

#### `/api/ops/action-queue` and `/api/ops/activity-log`
**Handler:** `src/app/api/ops/action-queue/route.ts`, `activity-log/route.ts`
**Used by:** `src/app/ops/components/ActionQueue.tsx`, `ActivityFeed.tsx` (sidebar widgets)
**Recommended allowlist:** `ALL_ROLES`
**Why:** Sidebar widgets render on every ops page.

#### `/api/ops/presence` and `/api/ops/presence/activity`
**Handler:** `src/app/api/ops/presence/route.ts`, `presence/activity/route.ts`
**Used by:** Online-now indicators on top nav
**Recommended allowlist:** `ALL_ROLES`
**Why:** Live presence pings.

#### `/api/ops/stream/recent` and `/api/ops/stream/changes`
**Handler:** under `src/app/api/ops/stream/`
**Used by:** Live-update streams across ops UI
**Recommended allowlist:** `ALL_ROLES`
**Why:** Real-time fan-out.

#### `/api/ops/agent` and `/api/ops/agent/messages`, `/api/ops/agent/workflows`
**Handler:** `src/app/api/ops/agent/*`
**Used by:** `src/app/ops/agent/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, SALES_REP, ESTIMATOR`
**Why:** Operator-side view of agent conversations / workflow approvals.

#### `/api/ops/gold-stock`, `[kitId]`, `[kitId]/build`
**Handler:** `src/app/api/ops/gold-stock/*`
**Used by:** `src/app/ops/portal/warehouse/gold-stock/page.tsx`
**Recommended allowlist:** `ADMIN, MANAGER, WAREHOUSE_LEAD, WAREHOUSE_TECH, PROJECT_MANAGER`
**Why:** Warehouse fast-pick kits page; PMs need read.

#### `/api/ops/qc-briefing`, `/api/ops/qc-trends`, `/api/ops/qc/metrics`
**Handler:** `src/app/api/ops/qc-*` and `qc/metrics`
**Used by:** Manufacturing/QC dashboards
**Recommended allowlist:** `ADMIN, MANAGER, QC_INSPECTOR, PROJECT_MANAGER, WAREHOUSE_LEAD`
**Why:** Same audience as `/api/ops/manufacturing`.

#### `/api/ops/estimator-briefing`
**Handler:** `src/app/api/ops/estimator-briefing/route.ts`
**Used by:** Estimator portal landing
**Recommended allowlist:** `ADMIN, MANAGER, ESTIMATOR, PROJECT_MANAGER`
**Why:** Mirrors estimator portal access.

#### `/api/ops/accounting-briefing`, `/api/ops/accounting-command`
**Handler:** `src/app/api/ops/accounting-*`
**Used by:** Dawn's accounting portal landing
**Recommended allowlist:** `ADMIN, MANAGER, ACCOUNTING`
**Why:** Mirrors `/ops/portal/accounting` rule.

#### `/api/ops/hyphen/documents/[id]` and `/api/ops/hyphen/unmatched`
**Handler:** `src/app/api/ops/hyphen/*`
**Used by:** Hyphen ingest review queue
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER`
**Why:** Brookfield/Hyphen integration review surface.

#### `/api/ops/cash-flow-optimizer/{collections,payment-terms,setup,working-capital}`
**Handler:** `src/app/api/ops/cash-flow-optimizer/*`
**Used by:** `/ops/cash-flow-optimizer` page
**Recommended allowlist:** `ADMIN, MANAGER, ACCOUNTING`
**Why:** Mirrors `/ops/cash-flow-optimizer` page-level rule already in `ROUTE_ACCESS`.

#### `/api/ops/procurement/*` (ai-assistant, inventory, suppliers, setup, calculate-usage)
**Handler:** `src/app/api/ops/procurement/*`
**Used by:** Purchasing portal pages
**Recommended allowlist:** `ADMIN, MANAGER, PURCHASING, PROJECT_MANAGER`
**Why:** Existing `/api/ops/procurement/purchase-orders` entry covers POs only; the rest of `/api/ops/procurement` falls through. Add a parent `/api/ops/procurement` prefix.

#### `/api/ops/smartpo/recommendations`, `/api/ops/smartpo/ship`
**Handler:** `src/app/api/ops/smartpo/*`
**Used by:** SmartPO queue actions (separate from `/api/ops/purchasing/smart-po` which IS covered)
**Recommended allowlist:** `ADMIN, MANAGER, PURCHASING`
**Why:** Same audience as `/api/ops/purchasing/smart-po`.

#### `/api/ops/scan-sheet`, `/api/ops/material-watch`, `/api/ops/shortages`
**Handler:** under `src/app/api/ops/`
**Used by:** Material status & PM material watch widgets
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, PURCHASING, WAREHOUSE_LEAD`
**Why:** Same audience as `/api/ops/material-eta` / `/api/ops/material-calendar`.

#### `/api/ops/sops`, `/api/ops/handbook` (handbook is Pile C, public)
**Handler:** `src/app/api/ops/sops/route.ts`
**Recommended allowlist:** `ALL_ROLES`
**Why:** SOPs are read-only company knowledge for everyone.

#### `/api/ops/divisions`, `/api/ops/phase-templates`, `/api/ops/phase-templates/[id]`
**Recommended allowlist:** `ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR, SALES_REP`
**Why:** Used in dropdowns on jobs/quotes pages.

#### `/api/ops/contacts`, `/api/ops/customers/health`, `/api/ops/credit-alerts` — see above (P0).

#### `/api/ops/system-alerts`
**Recommended allowlist:** `ADMIN, MANAGER`
**Why:** System-wide ops alerts; admin/manager surface.

#### `/api/ops/received-orders`, `/api/ops/auto-po`
**Recommended allowlist:** `ADMIN, MANAGER, PURCHASING, WAREHOUSE_LEAD`
**Why:** Receiving + PO suggestion flow; mirrors purchasing/warehouse audience.

#### `/api/ops/admin/qr-tags/log-print`, `/api/ops/admin/qr-tags/preview`, `/api/ops/admin/digest-preview`, `/api/ops/admin/integrations-freshness`, `/api/ops/admin/trends`, `/api/ops/admin/crons`, `/api/ops/admin/ai-usage`, `/api/ops/admin/data-quality`
**Recommended allowlist:** `ADMIN` (or `ADMIN, MANAGER` for trends/crons/integrations-freshness)
**Why:** Admin tooling. Currently 403 even for ADMIN-via-allowlist would be fine, but the silent default-deny is brittle — make it explicit.

### P1 — Background / less-trafficked

`/api/ops/auth/diagnose`, `/api/ops/auth/run-migrations`, `/api/ops/data-fix`, `/api/ops/data-quality`, `/api/ops/deliveries/[id]`, `/api/ops/homeowner-access`, `/api/ops/invoice-reminder`, `/api/ops/margin-defaults`, `/api/ops/margin-rules`, `/api/ops/nuc/status`, `/api/ops/outreach/tracker`, `/api/ops/seed-demo-data`, `/api/ops/supply-chain`, `/api/ops/tts`, `/api/ops/video-rooms`, plus all `/api/ops/migrate-*` and `/api/ops/migrate/*` variants — recommend explicit `ADMIN`-only entries. They 403 today by silent default-deny, but explicit is safer.

Special: `/api/ops/deliveries/[id]/send-confirmation` (PATCH) — `ADMIN, MANAGER, PROJECT_MANAGER, DRIVER, WAREHOUSE_LEAD` (mirrors `/api/ops/delivery`). Today 403s a driver trying to confirm a delivery. **P1, customer-facing.**

## Pile C — Unauthenticated (only the suspicious)

**Safe — public auth surface:** `/api/ops/auth/{login,logout,forgot-password,reset-password,setup-account,permissions}`. `/api/ops/auth/seed-admin` (gated on `ADMIN_SEED_ENABLED`+`ADMIN_SEED_KEY`, fail-closed). `/api/ops/auth/seed-staff` (`requireDevAdmin`).

**Safe — bearer auth:** `/api/ops/brain/webhook` (`Bearer NUC_BRAIN_API_KEY`), `/api/ops/brain/scores` (same), `/api/ops/brain/trigger-sync` (x-staff-id check), `/api/ops/brain/proxy` (middleware cookie), `/api/ops/brain-seed` (`Bearer CRON_SECRET`), `/api/ops/hyphen/ingest` (timing-safe `Bearer AEGIS_API_KEY`).

**Safe — `requireDevAdmin` (prod-blocked + ADMIN):** `/api/ops/cleanup`, `/api/ops/seed`, `/api/ops/seed-employees`, `/api/ops/seed-workflow`, `/api/ops/sales/seed-reps`.

**Safe — public/inline:** `/api/ops/handbook` (middleware carve-out, PDF). `/api/ops/manufacturing-command*` (inline header check; any logged-in staff can read).

**P2 — works but inconsistent:** `/api/ops/staff` and `/api/ops/staff/fix-passwords` — inline header check restricts to ADMIN/MANAGER. Should migrate to `requireStaffAuth({ allowedRoles: [...] })`.

### P0 — Genuinely missing auth (4 mutations, plus 1 high-impact GET)

#### P0 `/api/ops/import-bolt` (POST)
**Handler:** `src/app/api/ops/import-bolt/route.ts`
**Issue:** Bulk-imports customers, employees, crews, communities, jobs, work orders. No `requireDevAdmin`, no role check. Any authenticated staff (DRIVER, INSTALLER, anyone with a valid cookie) can POST a giant body and overwrite data.
**Fix:** Add `requireDevAdmin(request)` guard at the top, mirroring `/api/ops/import-box` etc. Other `import-*` routes do have API_ACCESS entries restricting to ADMIN/MANAGER, but this one bypasses that path entirely.

#### P0 `/api/ops/migrate-{agent-hub,all,cascades,documents,features,indexes,manufacturing,nfc,outreach,phase2..5,temporal}` (POST)
**Handler:** various `src/app/api/ops/migrate-*/route.ts`
**Issue:** Run DDL (CREATE TABLE, ALTER TABLE, ADD COLUMN). Several go through `checkStaffAuth` (Pile B) so they end up admin-only by default-deny accident; but these direct ones in Pile C have **no role check at all** beyond the JWT cookie. Any logged-in staff can fire schema mutations.
**Fix:** Add `requireDevAdmin` guard or move to admin-only API_ACCESS. Note: many of these are one-shot migrations that are theoretically idempotent / no-ops if already applied, but a malicious authenticated user could still cause noise/audit churn.

#### P0 `/api/ops/migrate/{ai-agent,builder-pricing-tiers,employee-onboarding,fix-order-totals,portal-overrides,route.ts}` (POST)
**Handler:** `src/app/api/ops/migrate/*/route.ts`
**Issue:** Same as above. `migrate/route.ts` adds Product.displayName; `fix-order-totals` rewrites Order.total values across the table.
**Fix:** Same — add `requireDevAdmin` or admin-only API_ACCESS.

#### P0 `/api/ops/sales/migrate` (POST)
**Handler:** `src/app/api/ops/sales/migrate/route.ts`
**Issue:** Same — DDL, no role check.
**Fix:** `requireDevAdmin`.

#### P0 `/api/ops/products/cleanup` (POST + GET)
**Handler:** `src/app/api/ops/products/cleanup/route.ts`
**Issue:** Re-maps every product's category in the DB. No auth check at all. Any logged-in staff can fire it.
**Fix:** `requireDevAdmin` or `checkStaffAuth` + add API_ACCESS entry for ADMIN/MANAGER/PURCHASING.

#### P0 `/api/ops/admin/data-quality/run` (POST)
**Handler:** `src/app/api/ops/admin/data-quality/run/route.ts`
**Issue:** Comment in the code: `// TODO: add session/role check to verify the caller is an admin`. Currently no check — any logged-in staff can trigger the data quality scan job.
**Fix:** `requireStaffAuth(request, { allowedRoles: ['ADMIN'] })`.

#### P1 `/api/ops/inbox` (GET/POST/PATCH), `/api/ops/inbox/[id]/{escalate,resolve,snooze,take-action}`, `/api/ops/inbox/scoped` (GET)
**Handler:** `src/app/api/ops/inbox/*`
**Issue:** No role check beyond middleware JWT validation. The mutations (escalate, resolve, snooze, take-action) write to `InboxItem` with the caller's identity from `getStaffFromHeaders`, but any role could mark another role's items resolved or take action on a financial PO approval item.
**Fix:** Add `/api/ops/inbox` entry to API_ACCESS = `ALL_ROLES` for read (the page is `ALL_ROLES`), but gate `take-action` and POST(create) at handler level with role-aware logic on `actionData.type` (e.g. PO_APPROVAL → ADMIN/MANAGER/PURCHASING; COLLECTION_ACTION → ADMIN/MANAGER/ACCOUNTING). Currently the redirect-based flow plus the secondary endpoint's own auth catches some of this, but a direct PATCH on `/api/ops/inbox` updating `status='COMPLETED'` is unprotected. **P0 for `/api/ops/inbox` PATCH specifically.**

#### P1 `/api/ops/manufacturing-ai`, `/api/ops/accounting-ai`, `/api/ops/manufacturing-command*`
**Handler:** `src/app/api/ops/manufacturing-ai/route.ts`, `accounting-ai/route.ts`, `manufacturing-command*/route.ts`
**Issue:** Inline header check `if (!staffId || !staffRole)` — any authenticated staff can call. Both AI routes invoke Anthropic API on the company's bill, and the accounting AI returns AR/AP totals which should not be visible to floor roles.
**Fix:** Add API_ACCESS entries: `/api/ops/accounting-ai` = ADMIN/MANAGER/ACCOUNTING; `/api/ops/manufacturing-ai` and `/api/ops/manufacturing-command` = ADMIN/MANAGER/QC_INSPECTOR/WAREHOUSE_LEAD/PROJECT_MANAGER. Either move to `checkStaffAuth` or repeat the check inline.

#### P1 `/api/ops/fleet` (GET)
**Handler:** `src/app/api/ops/fleet/route.ts`
**Issue:** Reads VIN data and driver DOB/DL numbers from a Box export folder on disk. **No auth check at all** beyond middleware JWT. Any logged-in staff can pull driver PII (DOB, DL number).
**Fix:** Add API_ACCESS entry (already `/api/ops/fleet` exists in API_ACCESS = ADMIN/MANAGER/PROJECT_MANAGER/DRIVER/WAREHOUSE_LEAD) but the route doesn't call `checkStaffAuth`. Wire `checkStaffAuth(request)` at the top of GET.

## Recap & R7 next wave

- **Pile A:** 360 covered.
- **Pile B:** 104 silently 403 every non-ADMIN. ~30 user-facing (P0), rest admin tooling/migrations (P1).
- **Pile C:** 46 bypass `checkStaffAuth`; 36 are safe by design. Remaining 10+ are P0.

R7: (1) add ~30 API_ACCESS entries from Pile B P0; (2) wire `requireDevAdmin` on the 8 unauth migration/cleanup/import routes; (3) add `checkStaffAuth` to `/api/ops/fleet` + inbox mutations; (4) migrate `/api/ops/staff*` to `requireStaffAuth({ allowedRoles })`. No commits made.
