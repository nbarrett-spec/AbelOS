# API Audit — `/api/*` route handlers vs. frontend usage

**HEAD:** `6169e25` — read-only audit, no source files modified.
**Scope:** All `route.ts` under `src/app/api/**`, all `fetch('/api/...')` calls under `src/app/`, `src/components/`, `src/lib/`, `src/hooks/`, and the RBAC registry in `src/lib/permissions.ts`.

## Headline numbers

| Metric | Count |
|---|---:|
| Route handler files | **766** |
| Total exported HTTP methods (GET/POST/PATCH/DELETE/PUT/HEAD/OPTIONS) | 1,092 |
| Frontend `fetch('/api/...')` call sites | 975 |
| Unique endpoint URLs called from the frontend | 497 |
| Dangling references (frontend → no route) | **6 unique** |
| Method mismatches (frontend method not exported by route) | **1** |
| Routes mutating without explicit handler-level auth (after middleware filter) | 9 (8 known-public + 1 real gap) |
| Entries in `permissions.ts → API_ACCESS` | 96 |
| Stale `API_ACCESS` entries pointing to non-existent routes | **3** |
| Routes that call `checkStaffAuth*` but are missing from `API_ACCESS` (default-deny non-ADMIN) | **142** |
| Duplicate / two-dynamic-sibling conflicts | 0 |

The platform's auth model is **middleware-first**: `src/middleware.ts` short-circuits all `/api/ops/*` to require a `abel_staff_session` JWT cookie and all `/api/admin/*` to require ADMIN role. Most surface-level "no auth in handler" findings are noise because of that. The genuine issues are below.

---

## HIGH PRIORITY — dangling frontend → backend references (8 call sites)

These are guaranteed 404s when the user takes the action.

| Method | Frontend URL | Caller | Notes |
|---|---|---|---|
| GET | `/api/dashboard/home-v2?tenant=...` | `src/app/aegis-home/page.tsx` | No `/api/dashboard/*` directory exists at all. Either delete the page or stub the route. |
| POST | `/api/ops/accounts/${builderId}/statement/send` | `src/app/ops/accounts/[id]/page.tsx` | Account detail page → "Send statement" button. Only `/api/account/statement` (no `ops` prefix, no `[id]`) exists. |
| POST | `/api/ops/jobs/${taskJobId}/tasks` | `src/app/ops/portal/pm/page.tsx` | PM portal "create task on job". No `/api/ops/jobs/[id]/tasks` route handler. |
| PATCH | `/api/ops/sales/deals/${dealId}/activities/${activityId}` | `src/app/ops/sales/deals/[id]/page.tsx` | Editing an existing deal activity. The collection route `/api/ops/sales/deals/[id]/activities` exists, but no `[activityId]` child for PATCH. |
| POST | `/api/ops/tasks/${taskId}/complete` | `src/app/ops/today/TodayDashboard.tsx` | The Today page's "complete task" action. No `/api/ops/tasks/*` directory at all. |

(The earlier scan also flagged `/api/ops/manufacturing/bom${search ? ... : ...}` and similar — those are multi-line template literals with conditional query strings. The route exists; treat as false positive.)

**Recommendation:** PM portal task creation (`#3`) and Today's complete-task button (`#5`) are user-visible Monday blockers. Statement-send (`#2`) is a customer-facing button. The deal-activity PATCH (`#4`) breaks editing existing activities. Add the four route stubs or remove the broken UI before launch. `home-v2` is dead code from an old iteration — safe to delete the page or stub a redirect.

---

## HIGH PRIORITY — wrong HTTP method

| Method (called) | Route | Methods supported by route | Caller |
|---|---|---|---|
| POST | `/api/builder/onboarding` | GET, PATCH | `src/app/dashboard/onboarding/page.tsx:158` |

The onboarding form submits via POST but the handler only exports GET (load steps) and PATCH (mark step done). Either change the handler to accept POST, or change the frontend to PATCH.

---

## MEDIUM PRIORITY — unauthenticated mutations

After filtering for routes covered by middleware (`/api/ops/*` and `/api/admin/*` are gated at the edge) and known-public routes (login/signup/forgot-password, builder register, error reporter, webhooks with HMAC verification), one real concern stands out:

| Route | Method | File | Concern |
|---|---|---|---|
| `/api/door/[id]` | POST | `src/app/api/door/[id]/route.ts:165` | Header comment says "staff only — QC, staging, delivery, install, bay moves." Handler reads `staffId` and `staffName` from the request body and writes them to `qcPassedBy`, `installedBy`, etc. There is **no auth check**. Any unauthenticated caller can flip a door's status and forge the staff name. |

The other 8 unauth routes are either documented public flows (`/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/dev-login`, `/api/auth/logout`, `/api/builders/register`, `/api/client-errors`) — confirmed safe.

`/api/agent/sms` is a stub returning 501 ("Twilio not wired up"). Not a security issue but flagged here for completeness.

`/api/homeowner/[token]/{confirm,selections,upgrades}` use the URL token as the auth credential and validate it server-side. That's the deliberate design.

`/api/internal/security-event` is protected by `INTERNAL_LOG_SECRET` shared-secret (middleware → itself).

`/api/webhooks/stripe` calls `verifyWebhookSignature` on the body — fine.

**Recommendation:** add `checkStaffAuthWithFallback` to `/api/door/[id]` POST before launch. One-line change.

---

## HIGH PRIORITY — `API_ACCESS` registry gaps

`src/lib/permissions.ts → API_ACCESS` is the role-based map consumed by `canAccessAPI()` (called from `src/lib/api-auth.ts → checkStaffAuthWithFallback` and friends). When a route calls one of those auth helpers but the path isn't covered by `API_ACCESS`, `canAccessAPI` falls through to **default-deny for everyone except ADMIN**.

### 142 routes call `checkStaffAuth*` but have no `API_ACCESS` entry

That means 142 endpoints today work for Nate (ADMIN) but 403 for every other staff role. Many of them are surfaced from non-admin portals — those will silently break for Dawn, Brittney, Chad, etc.

**Top examples that map to active portals (non-ADMIN must use these):**

```
/api/ops/communication-logs                    Communication log feed (PM, sales, accounting)
/api/ops/communication-logs/gmail-fetch        Gmail thread fetcher
/api/ops/communication-logs/gmail-sync         Gmail backfill (also has API-key path)
/api/ops/inspections, /[id], /[id]/photos      QC inspections module
/api/ops/inspections/templates                 Inspection template library
/api/ops/kpis, /kpis/export                    KPIs page (everyone)
/api/ops/lien-releases, /[id]                  Accounting lien-release queue
/api/ops/mrp/*  (12 routes)                    MRP module — daily-output, forecast, projection,
                                                shortage-summary, stockouts, suggest-po,
                                                production-queue, demand-heatmap, draft-pos,
                                                bom-explode/[orderId], job-materials/[jobId]
/api/ops/projects/[projectId]/timeline         Project timeline view
/api/ops/projects/command-center               Command center
/api/ops/projects/standup/[pmId]               PM standup feed
/api/ops/sales-briefing, /sales-scorecard      Daily sales briefing + scorecard
/api/ops/warehouse-briefing                    Daily warehouse briefing
/api/ops/warehouse/{bays,cross-dock,daily-plan,pick-verify,picks-for-job,ready-to-pick}
                                                Warehouse module (Gunner's team)
/api/ops/trim-vendors, /[id]                   The newly added trim-vendor module — confirmed
                                                missing from API_ACCESS as expected.
```

**Recommendation:** the orchestrator should add an `API_ACCESS` entry for every `/api/ops/{trim-vendors,inspections,kpis,lien-releases,mrp,projects,communication-logs,sales-briefing,sales-scorecard,warehouse,warehouse-briefing,inbox}` prefix. The full list is generated in `scripts/_tmp_audit_data.json → portalAffected` (34 entries). Without these, those non-admin portal pages will render but every API call will 403.

### Stale `API_ACCESS` entries (no matching route handler)

| Entry | Reality |
|---|---|
| `/api/ops/purchase-orders` | Only `/api/ops/procurement/purchase-orders/*` exists. Likely a refactor leftover; the prefix never got renamed in `permissions.ts`. |
| `/api/ops/communication-log` | Singular. Real path is `/api/ops/communication-logs` (plural). Typo. |
| `/api/ops/run-migration` | Doesn't exist. Closest matches are `/api/ops/migrate` (no auth — see below) and `/api/ops/auth/run-migrations`. |

**Recommendation:** fix the typo (`communication-log` → `communication-logs`), repoint the PO entry to `/api/ops/procurement/purchase-orders` (or add both), and either delete the `run-migration` entry or repoint it.

---

## Conflicting / duplicate routes

**0 conflicts.** No directory has two `[param]` siblings, and no concrete-vs-dynamic clashes were detected. Next.js's static-over-dynamic resolution handles the existing patterns cleanly.

---

## Recommendations — Monday-blocker vs post-launch

### Monday blockers (user-visible breakage on launch day)

1. **Add the 5 missing route stubs** for the dangling references above (`/api/ops/jobs/[id]/tasks`, `/api/ops/tasks/[id]/complete`, `/api/ops/accounts/[id]/statement/send`, `/api/ops/sales/deals/[id]/activities/[activityId]`, plus dispose of the `/api/dashboard/home-v2` reference).
2. **Fix `/api/builder/onboarding` method mismatch** — onboarding submission breaks today.
3. **Add `API_ACCESS` entries** for the 34 portal-affected route prefixes listed above. Without them, every staff member except Nate will hit 403 on the inspections, KPI, MRP, warehouse, sales-briefing, lien-releases, and trim-vendors pages.
4. **Add staff auth to `/api/door/[id]` POST.** Anyone on the public internet can currently mark a door as QC-passed under any name.

### Post-launch cleanup

1. **Resolve the 3 stale `API_ACCESS` entries** (rename, repoint, or remove).
2. **Move the 108 non-portal `checkStaffAuth` routes that are missing from `API_ACCESS`** (e.g. migrate/seed/admin-internal/agent endpoints) into the registry — even ADMIN-only ones, for documentation and to make the default-deny visible.
3. **Audit `/api/ops/migrate*` series** (13 endpoints): they go through middleware-staff-auth at the edge but several do `prisma.$executeRawUnsafe` of DDL with no role check beyond "any staff cookie." Restrict to ADMIN explicitly.
4. **Delete or finish `/api/agent/sms`** stub.
5. **Document the `/api/homeowner/[token]/*` token-as-auth pattern** in `permissions.ts` so it doesn't keep tripping audits.

---

## Method notes

The audit script lives at `scripts/_tmp_audit_api.cjs` and writes raw findings to `scripts/_tmp_audit_data.json`. Auth detection looks for the documented patterns: `checkStaffAuth(WithFallback)?`, `requireStaffAuth`, `verifyEngineToken`, `requireApiKey`, `requireAuth`, `getStaffSession`, `getSession`, `verifyToken(` (builder cookie), webhook-signature helpers, shared-secret env-var checks (`CRON_SECRET`, `INTERNAL_LOG_SECRET`, `AEGIS_API_KEY`, etc.), `requireAdmin`/`requireDevAdmin`. URL canonicalization handles trailing query-string interpolations and template path params; multi-line templates with conditional query strings (one-off in `manufacturing/bom`) remain a known false-positive class. Cap: 1,500 words target; this report is ~1,150.
