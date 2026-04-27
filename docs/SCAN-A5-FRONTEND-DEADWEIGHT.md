# SCAN-A5 — Frontend Deadweight

- **HEAD:** `171a6b4`
- **Generated:** 2026-04-27
- **Scope:** `src/app/ops/**/*.tsx`, `src/components/**/*.tsx`. READ-ONLY scan.
- **Verification:** `npx tsc --noEmit --skipLibCheck` invoked as no-op (no source modified).

## Counts

| Metric | Count |
|---|---:|
| Pages under `src/app/ops` | 242 |
| `console.log` in `src/app/ops` | 1 (one ops page; unrelated `console.error` is fine) |
| `onClick={() => {}}` literal no-op handlers | 9 (1 page) |
| `.catch(() => {})` swallowed errors | 18 |
| Pages with `Loading…` UI but no error UI | 17 (representative; pattern is widespread) |
| Always-disabled buttons (backend not wired) | 3 distinct controls |
| TODO/FIXME comments in user-facing code | 10 |
| Orphan pages (cf. AUDIT-UI) | 60 (re-confirmed; mostly intentional) |

The pattern of these findings: not "site falls over" — the platform shipped April 13 and works for the happy path. The deadweight is concentrated in **demo/showcase pages** (Sales Command Center) and in **gracefully-degraded UI for endpoints that haven't shipped yet** (job→order linking, installer assignment, collection emails).

---

## P0 — User-visible "this button does nothing"

### 1. Sales Command Center has 9 dead `onClick={() => {}}` action buttons
- **File:** `src/app/ops/sales/command-center/page.tsx:684, 690, 696, 1104, 1110, 1116, 1305, 1984` (one more at 2006 "View Detailed Report")
- **Evidence:** Every Lead row renders `Call`, `Email`, `Deal` quick-action buttons whose handler is the empty arrow `() => {}`. Every churn row renders `Follow Up`, `Won`, `Lost`. The "View Account Details" and "View Detailed Report" buttons in the Outreach panel are also wired to `() => {}`. The `import { useCallback }` is present at line 3 — the placeholder was always intended to get filled.
- **Impact:** This is the page Nate or sales reps would click first if they opened "Sales Command Center" off the sidebar. Eight clickable controls produce zero feedback. No toast, no console error, no navigation. Looks broken.
- **Fix:** Either (a) remove the buttons until the actions ship, or (b) wire each: `Call` → `tel:` link, `Email` → `mailto:` or `/api/ops/agent` send, `Deal` → push to `/ops/sales/pipeline?builderId=…` (creates new), `View Account Details` → `/ops/accounts/${id}`. Each is a one-line change.

### 2. Job profile "View All →" billing-phases button does nothing
- **File:** `src/app/ops/jobs/[jobId]/profile/page.tsx:357`
- **Evidence:** `<button onClick={() => {}} className="text-xs font-semibold text-blue-600 hover:underline">View All →</button>`. Looks like a link (blue + arrow) but is a button with no behavior.
- **Impact:** PM clicks "View All" expecting a phases drilldown. Nothing happens. The styling actively lies — the cursor turns into a hand and the underline appears on hover.
- **Fix:** Either remove the button, or `Link` to `/ops/jobs/${jobId}#phases` once a Phases sub-section exists. Phases are already inlined below it, so the button is redundant — easiest is delete.

### 3. Cash dashboard "Send Email" alerts "Not implemented"
- **File:** `src/app/ops/finance/cash/page.tsx:467-474`
- **Evidence:** `sendCollectionEmail` function explicitly `alert()`s "Not implemented: collection email for X. No backing endpoint yet." The TODO at line 468 confirms `/api/ops/collections/send-email` doesn't exist.
- **Impact:** P0 because the button is rendered to Dawn (Accounting Manager) and Nate. They click, get a popup. This is *honest* deadweight (better than silent), but the calling button shouldn't be visible until backed.
- **Fix:** Hide the button entirely behind a `disabled` + tooltip until the endpoint ships. Or wire to the existing `/api/ops/collections` POST (collection cycle) which already sends mail through `lib/notifications.ts`.

### 4. Job profile "Link to Order" button is permanently disabled
- **File:** `src/app/ops/jobs/[jobId]/page.tsx:985-993, 1017-1024`
- **Evidence:** `<button type="button" disabled onClick={() => setShowLinkOrder(true)} title="Backend endpoint /api/ops/jobs/[id]/link-order does not exist yet" …>Link to Order (backend not wired)</button>`. The TODO at 981-984 says PATCH `/api/ops/jobs/[id]` does not include `orderId` in `validFields`.
- **Impact:** The UI tells the user the backend isn't wired. Clear, but visible on every job profile page where there's no linked order. There are ~hundreds of jobs in production. Every PM who opens an unlinked job sees a broken-looking button.
- **Fix:** Add `orderId` to `validFields` in the PATCH `/api/ops/jobs/[id]` endpoint (server-side change, not in this scan's scope but cheap). Then enable the button.

### 5. Job profile "Assign Installer" select is permanently disabled
- **File:** `src/app/ops/jobs/[jobId]/page.tsx:1047-1054`
- **Evidence:** `<select … disabled title="Cannot save — schema change required (Job has no installerId / trimVendorId / meta column)">`. Comment 1041-1046 confirms the Job model has no installer column.
- **Impact:** Same as above. Visible on every job. PM cannot use it.
- **Fix:** Schema migration to add `installerId` / `trimVendorId` to `Job`, or build `/api/ops/jobs/[id]/assign-installer` that writes to a junction table. Out of scan scope.

---

## P1 — Silent UX gaps (loading forever / no error state)

### 6. Audit log silently shows "no logs" on API failure
- **File:** `src/app/ops/audit/page.tsx:58-83`
- **Evidence:** `fetchLogs` does `Promise.all([fetch(/api/ops/audit?…), fetch(/api/ops/audit?view=stats)])`, then `await .json()` on both. If either throws, the `catch (e) { console.error(e) }` swallows the error. `setLoading(false)` runs unconditionally after the catch, leaving `logs=[]`, `stats=null`. The user sees "0 audit events" which is indistinguishable from "the audit log is genuinely empty."
- **Impact:** When the audit DB is unhealthy or the route 500s, Nate or auditors see "no activity." Bad for compliance posture.
- **Fix:** Add `error` state. In catch: `setError('Failed to load. Try refreshing.')`. Render a red banner above the table when `error` is set. Same template as `/ops/portal/accounting/page.tsx:179` already uses elsewhere.

### 7. SEO dashboard has same silent-failure pattern
- **File:** `src/app/ops/marketing/seo/page.tsx:20-39`
- **Evidence:** `loadData` catches all errors with `console.error(err)` and falls into `finally { setLoading(false) }`. Loading clears, empty grid renders.
- **Impact:** SEO dashboard goes from "Loading SEO dashboard…" to a card grid that says "Keywords Tracked: 0." Looks normal — nobody knows the API is down.
- **Fix:** Add error state and render `<EmptyState>` (already imported at line 5) with `kind="error"` when fetch throws.

### 8. Agent inbox swallows 30-second polling errors
- **File:** `src/app/ops/agent/page.tsx:71-94`
- **Evidence:** The 30-second poll interval (line 67) calls `loadData()` which silently catches. If the backend goes down for 5 minutes, the user sees a stale conversation list with no indication that polling failed. No "last updated" timestamp, no "stale" badge.
- **Impact:** Nate replies to a conversation that's been "resolved" 4 minutes ago by another staffer. Toast says "sent" but it's against stale state.
- **Fix:** Track `lastPollSuccess` timestamp. Render a yellow banner ("Connection lost — last update X minutes ago") when more than 60 seconds since last successful poll.

### 9. Eighteen `.catch(() => {})` calls swallow errors silently
- **Files:** `src/app/ops/accounts/[id]/page.tsx:459`, `accounts/page.tsx:71`, `communities/page.tsx:115`, `finance/modeler/page.tsx:58`, `jobs/[jobId]/CoPreviewSheet.tsx:163`, `quote-requests/page.tsx:62, 78`, `profile/page.tsx:81, 88`, `mrp/page.tsx:191`, `warranty/page.tsx:118`, `orders/page.tsx:101`, `purchasing/page.tsx:198, 211, 224`, `quotes/page.tsx:185, 194, 203`. (full list in scan grep above)
- **Evidence:** Pattern is `fetch(...).then(...).catch(() => {})`. Most are auxiliary "fill the dropdown" calls (vendors list, builders list, PMs list). When they 500, the dropdown silently shows "no options" — user can't proceed.
- **Impact:** Specifically `purchasing/page.tsx:198-224` is three of these in a row — PM/Builder/Vendor dropdowns on the **Create Purchase Order** page. If any of those endpoints is down, PO creation appears broken with no explanation.
- **Fix:** At minimum, log to Sentry and show a small "Failed to load — refresh" indicator next to the affected dropdown. Don't silently degrade primary creation flows.

### 10. `/ops/deliveries/[id]` route is referenced but never built
- **File:** `src/app/ops/jobs/[jobId]/DeliverySignOff.tsx:292-300`
- **Evidence:** TODO comment says route isn't implemented, falls back to `<Link href={/ops/deliveries?jobId=${jobId}}>`.
- **Impact:** Per AUDIT-UI: `/ops/deliveries/[id]` is in the link target list (line 3 of audit). The fallback link goes to the deliveries list filtered by job — works, but the "View" button reads as if it should drill into the specific delivery.
- **Fix:** Build `src/app/ops/deliveries/[id]/page.tsx` (the route is already in the audit). Once built, switch the Link.

---

## P2 — Code smell / dev leftovers

### 11. `console.log('Sync results:', data)` left in user code
- **File:** `src/app/ops/brain/page.tsx:106`
- **Evidence:** Inside `handleSync` after a successful `/api/ops/brain/trigger-sync` call. `console.error` at 109/112 are fine — the `console.log` is the leftover.
- **Impact:** Logs internal sync payload to browser console in production — could leak scan-result structure to anyone with devtools open.
- **Fix:** Delete line 106.

### 12. PWA `console.log` in production bundle
- **File:** `src/components/PWARegister.tsx:12` — `console.log('SW registered:', …)` on every page load. Wrap in NODE_ENV check or remove.

### 13. `window.location.reload()` used 12× for "retry"
- **Files:** `src/app/ops/portal/{sales,delivery,accounting,purchasing,estimator,pm}/**/page.tsx`
- **Evidence:** All twelve match `() => { setError(null); window.location.reload() }`.
- **Impact:** Full page reload loses scroll, modal state, in-progress edits.
- **Fix:** Replace with `() => { setError(null); loadData() }`. ~5 min per file.

### 14. PM Activity feed page hard-gated off
- **File:** `src/app/ops/pm/activity/page.tsx:25-49` — feature-flag returns "disabled" message. Decision needed: ship feature, or remove page + sidebar entry.

### 15. Quote-edit modal uses `disabled` not `readOnly`
- **File:** `src/app/ops/quotes/page.tsx:857, 866` — quote-number and status inputs are `disabled` (not tab-focusable, not announced). Change to `readOnly`.

### 16. TODO(filter-wiring) breadcrumb at `/ops/quotes/conversion`
- **File:** `src/app/ops/quotes/conversion/page.tsx:209, 275, 382` — three drilldown `<Link>`s target `/ops/products?category=…`, `/ops/quotes?search=…`, `/ops/quotes?month=…` but the destination pages don't read those params on mount.
- **Impact:** Click "Doors" → land on unfiltered product list. User retypes.
- **Fix:** Add `useSearchParams()` in destination pages and hydrate filter state.

### 17. False positive: `placeholder="SO-XXXXX"`
- **File:** `src/app/ops/warehouse/doors/page.tsx:378` — XXXXX is the order-number placeholder, not a TODO. Documented to suppress next scan.

---

## Accessibility gaps (representative)

- **`aria-label`:** 103 occurrences across 52 files. Icon-only buttons (`NotificationBell`, sidebar) labeled OK.
- **Color-only state:** 20 files use colored status dots. Most pair with text. Exceptions: `notifications/page.tsx`, `live-map/page.tsx`, `messages/page.tsx` (P2).
- **Form labels:** Some legacy forms use `<label>` without `htmlFor` — visual-only association. P2.

---

## Dead routes — re-confirmation

AUDIT-UI flagged 60 orphans. Sample re-check of 10 (`brain/page`, `cash-flow-optimizer`, `delegations`, `customer-catalog`, `pm/activity`, `audit`, `automations`, `procurement-intelligence`, `outreach/tracker`, `growth/permits`): 7 reachable via sidebar; 3 genuinely unlinked (`pm/activity` feature-off, `customer-catalog` legacy, `growth/permits` no nav). **No new P0 dead routes.** AUDIT-UI's 60 figure stands.

---

## Recommended Monday-blocker triage (fix in this order)

| Sev | What | Effort |
|---|---|---|
| P0 | Sales Command Center 9 dead onClick handlers (#1) | 30 min — wire or delete |
| P0 | `View All →` button on job profile (#2) | 5 min — delete |
| P0 | Hide Cash dashboard "Send Email" until endpoint exists (#3) | 5 min |
| P1 | Audit log + SEO dashboard error states (#6, #7) | 30 min |
| P1 | Agent polling stale-data banner (#8) | 30 min |
| P1 | Replace `.catch(() => {})` on PO-creation dropdowns with visible errors (#9) | 1 hr |
| P2 | Remove `console.log` in `/ops/brain` and `PWARegister` (#11, #12) | 2 min |

**Total to clear P0+P1: under 4 hours.**
