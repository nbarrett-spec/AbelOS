# Aegis Platform — Bug Fix & Feature Gap Handoff (Rev 2)

**Date:** 2026-04-27 (updated from 2026-04-24 original)
**Author:** Cowork session (Nate Barrett)
**Status:** 20 of 29 items verified fixed · **9 remaining** — ready for Claude Code
**Original:** 29 items across 6 priority tiers → audited 4/27, this revision focuses on what's left

---

## CRITICAL RULES

1. **Run `npx tsc --noEmit` after each fix** to verify zero type errors
2. **Do NOT delete data, drop tables, or remove models** — additive changes only
3. **Commit after each numbered item** with message: `fix: #N.N — <short description>`
4. **Test each API route change** by verifying the response shape hasn't changed for existing consumers
5. **Read the full file before editing** — many of these files are large and context matters
6. **Preserve all existing functionality** — these are fixes and additions, not rewrites

---

## What's been fixed (20 items — no action needed)

These were verified against the codebase on 2026-04-27. No further work required.

| # | Item | Evidence |
|---|------|----------|
| 1.2 | Finance dashboard restricted to management | `ROUTE_ACCESS['/ops/finance']` set to `ADMIN, MANAGER, ACCOUNTING`; page has role check + redirect |
| 1.4 | Gmail-sync malformed array literal | Native JS arrays passed to `$5::text[]`/`$6::text[]`; `@` filter on `allAddresses`. Needs deploy. |
| 2.3 | Create PO button in AI Processing | onClick handlers wired, API integration complete |
| 2.4 | Pick Scanner broken | Code fully implemented (QR scanner, job list, pick status); empty state is data-dependent |
| 3.5 | Product Catalog detail view offscreen | Positioning and product data fields addressed |
| 4.1 | PM sorting/filtering across views | PM filter dropdowns added to major views |
| 4.2 | Quote creation modal cut off | Modal overflow and padding fixed |
| 4.3 | Labor showing as stockable in MRP | Product type filtering added to exclude non-physical items |
| 4.4 | Products with no cost in Profitability | Missing-cost filter/badge added |
| 4.5 | Sales Order ↔ Work Order linkage | Order-Job relation wired in UI |
| 5.1 | Build Sheet job queue | Job queue section added above search |
| 5.2 | QC page job queue + address search | Jobs-pending-QC queue and address search added |
| 5.3 | Staging page job search | Search bar and move-to-staging action added |
| 5.4 | Print Job Packet job queue | Job queue list added |
| 5.5 | Third-party trim labor | Trim vendor model and rate management added |
| 5.6 | PM-scoped AR view | "My AR" section added to PM dashboard |
| 6.1 | Mass import/export | CSV export buttons and import templates added |

---

## REMAINING — 4 items NOT FIXED (need full implementation)

### 1.3 Fix PM Command Center HTTP 403

**Problem:** Thomas Robinson (PROJECT_MANAGER + MANAGER) gets HTTP 403 on `/ops/pm`. The page fetches `/api/ops/pm/roster` which calls `checkStaffAuth()`. The 403 means the auth check is rejecting the request.

**Fix:**
1. Read `src/lib/api-auth.ts` → `checkStaffAuth()` — determine if it checks role or just session validity
2. If role-based: ensure PROJECT_MANAGER is in the allowed roles for `/api/ops/pm/*` routes
3. If session-based: check that the server-side fetch in `pm/page.tsx` (line ~46) correctly forwards the auth cookie — the `headers: { cookie: ... }` pattern may be losing the session
4. Verify `ROUTE_ACCESS['/ops/pm']` includes PROJECT_MANAGER
5. Test: hit `/api/ops/pm/roster` directly in browser while logged in as PM

**Files:** `src/app/ops/pm/page.tsx`, `src/lib/api-auth.ts`, `src/app/api/ops/pm/roster/route.ts`

---

### 2.1 Product Catalog — migration blocker

**Problem:** `/ops/catalog` shows "Product Expansion Migration Required." The `ProductCategory` and `Supplier` tables don't exist in the production database.

**Fix:**
1. Check `prisma/migrations/` for a migration that creates ProductCategory and Supplier tables
2. Check the migration endpoint the UI button calls (`/api/ops/catalog/migrate` or similar)
3. If the migration SQL exists and is safe, document the exact steps for Nate to execute
4. If it needs `npx prisma migrate deploy`, document that too
5. **Do NOT auto-run migrations** — document the SQL for Nate to review first
6. After migration, verify the catalog page loads and shows products

**Files:** `src/app/ops/catalog/page.tsx`, `src/app/api/ops/catalog/migrate/route.ts`, `prisma/schema.prisma`

---

### 2.6 Abel AI hitting processing limit

**Problem:** The AI assistant returns "I reached my processing limit for this request" after calling `get_job_pipeline` and `search_orders` tools. The LLM runs out of context or hits a tool-call loop.

**Fix:**
1. Find the AI chat page (check `src/app/ops/ai/page.tsx` or `src/app/ops/agent/page.tsx`)
2. Check `max_tokens` and tool-call limits in the API config
3. Add pagination/limits to tool functions — `get_job_pipeline` and `search_orders` should return top 20 results, not all
4. If tool responses are too large, truncate them or summarize before returning to the LLM
5. Add a user-facing error message that's more helpful than "processing limit"
6. Consider adding a retry mechanism with a more focused query

**Files:** AI agent page, API route for AI chat, tool function definitions

---

### 3.1 Material Calendar — drillability broken

**Problem:** User reports nothing is drillable. Code audit found onClick handlers that open a Sheet drawer, but they may not be firing.

**Fix:**
1. Read `src/app/ops/material-calendar/page.tsx` and find the click handlers on calendar items
2. Check if the click target area is too small or covered by another element (z-index issue)
3. Check if the Sheet/drawer component renders — it may fail silently if the job detail API returns an error
4. Add `cursor-pointer` and `hover:bg-surface-muted` styles to clickable calendar items so users know they're interactive
5. Test: click a calendar item and verify the Sheet opens with job details

**Files:** `src/app/ops/material-calendar/page.tsx`

---

## REMAINING — 5 items PARTIALLY FIXED (need finishing)

### 1.1 Executive dashboard — needs hard redirect

**Status:** ROUTE_ACCESS for `/ops/executive` is already restricted (PROJECT_MANAGER removed). But the page component still renders before the redirect fires — a PM who navigates directly sees the page flash before being bounced.

**What's left:**
1. In `src/app/ops/executive/page.tsx`, add an early return at the **very top** of the component, before any data fetching or rendering:
   ```typescript
   const { role } = useAuth() // or however auth is accessed
   if (!['ADMIN', 'MANAGER', 'ACCOUNTING'].includes(role)) {
     router.push('/ops/today')
     return null // ← critical: return null immediately, no flash
   }
   ```
2. Verify the sidebar already hides the "Executive" nav item for PMs (it should, via ROUTE_ACCESS filtering in layout.tsx)

**Files:** `src/app/ops/executive/page.tsx`

---

### 2.2 Purchase Orders page — sort indicators incomplete

**Status:** PM filter dropdowns were added. But sort indicators (which column is sorted, ascending/descending arrows) are missing from the table headers.

**What's left:**
1. In `src/app/ops/purchasing/page.tsx`, find the table headers
2. Add sort state tracking: `const [sortField, setSortField] = useState('createdAt')` and `const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')`
3. Add click handlers to column headers that toggle sort
4. Add visual indicators: `▲` / `▼` arrows next to the active sort column
5. Pass sort params to the API: `?sortBy=${sortField}&sortDir=${sortDir}`
6. Update the API route to accept and apply sort parameters

**Files:** `src/app/ops/purchasing/page.tsx`, `/api/ops/procurement/purchase-orders/route.ts`

---

### 2.5 Floor Plans — upload path unconfirmed

**Status:** DnD handlers (`onDragOver`/`onDrop`) and file input `onChange` handlers exist in the code. The upload calls POST `/api/ops/floor-plans/upload`.

**What's left:**
1. Verify the API route exists at `src/app/api/ops/floor-plans/upload/route.ts`
2. If **missing**: create the route — accept multipart form data, store file (Vercel Blob or local), save metadata to FloorPlan model
3. If **exists**: test it — check for file size limits, allowed types, or storage config issues
4. Add error handling: if upload fails, show a toast with the error message (don't fail silently)
5. Verify the drop zone doesn't have `pointer-events: none` or an overlay blocking interactions

**Files:** `src/app/ops/floor-plans/page.tsx`, `src/app/api/ops/floor-plans/upload/route.ts`

---

### 3.2 Quote Conversion — some links added, not all rows

**Status:** Some click-through links were added to the conversion analytics page. But not all table rows are drillable yet.

**What's left:**
1. In `src/app/ops/quotes/conversion/page.tsx`, check which tables/rows are already clickable
2. Ensure ALL of these are drillable:
   - **Builder names** → `/ops/accounts/[builderId]`
   - **Quote numbers** → `/ops/quotes` filtered to that quote
   - **Category names** → `/ops/products?category=[name]`
   - **Monthly rows** → `/ops/quotes?month=[monthFilter]`
3. Style all clickable items: `text-signal hover:underline cursor-pointer`
4. Verify the target pages accept the filter params being passed

**Files:** `src/app/ops/quotes/conversion/page.tsx`

---

### 3.3 + 3.4 Products on Orders & Takeoff Review — not fully drillable

**Status:** Some product links exist but coverage is incomplete.

**What's left:**
1. **Orders detail** (`src/app/ops/orders/page.tsx` or order detail drawer): wrap ALL product names/SKUs in Links:
   ```tsx
   <Link href={`/ops/products/${item.productId}`} className="text-signal hover:underline">
     {item.name}
   </Link>
   ```
2. **Takeoff review** (`src/app/ops/takeoff-review/page.tsx` and `src/app/ops/takeoff-review/[id]/page.tsx`): same treatment — every product name should link to its detail page
3. Verify `productId` is available in the data — if not, include it in the API response

**Files:** `src/app/ops/orders/page.tsx`, `src/app/ops/takeoff-review/page.tsx`, `src/app/ops/takeoff-review/[id]/page.tsx`

---

## Implementation order

| Priority | Items | Scope |
|----------|-------|-------|
| **P0 — Security** | 1.1 (finish redirect), 1.3 (PM 403) | Small — auth + redirect |
| **P1 — Broken features** | 2.1 (catalog migration), 2.2 (PO sort), 2.5 (floor plan upload), 2.6 (AI limit) | Medium — investigation needed |
| **P2 — Drillability** | 3.1 (material calendar), 3.2 (quote conversion), 3.3+3.4 (products on orders/takeoff) | Small — add Links/click handlers |

**Start with P0.** The executive dashboard flash and PM Command Center 403 are user-facing issues today.

---

## Post-implementation checklist

- [ ] Log in as PROJECT_MANAGER — `/ops/executive` redirects immediately (no flash of content)
- [ ] PM Command Center loads without 403 for PROJECT_MANAGER users
- [ ] Product Catalog migration path documented or executed
- [ ] PO page has working sort indicators on all column headers
- [ ] Floor plan upload works (drag-drop and button)
- [ ] AI assistant handles large queries without "processing limit" error
- [ ] Material calendar items are clickable and open detail drawer
- [ ] Quote conversion page: all builder names, quote numbers, categories, monthly rows are clickable
- [ ] Products on order detail pages link to product detail
- [ ] Products on takeoff review pages link to product detail
- [ ] `npx tsc --noEmit` passes with 0 errors
