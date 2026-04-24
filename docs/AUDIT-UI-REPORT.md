# AUDIT-UI Report

- **HEAD:** `6169e25`
- **Generated:** 2026-04-24
- **Scope:** `src/app/**/page.tsx`, `src/app/ops/layout.tsx` sidebar, all `<Link>` and `href="/..."` references in `src/app/` and `src/components/`.

## Counts

| Metric | Count |
|---|---:|
| Total `page.tsx` under `src/app/` | **327** |
| Sidebar nav items in `src/app/ops/layout.tsx` | **159** |
| Distinct internal `href="/..."` link targets | **152** |
| Sidebar items with no matching page | **0** |
| Dead `<Link>` targets pointing to nonexistent pages | **7** (real) + 3 false positives |
| Orphan pages (no Link or sidebar reference) | **60** (most are intentional, see below) |
| Missing UI barrel exports | **0** |

---

## HIGH — Dead Links (will 404)

These are `<Link>` / `<a href>` references to internal routes with **no** matching `page.tsx`. Three of the ten flagged are static-asset / API references and not bugs (noted as FP).

| Bad href | Used by | Likely intent |
|---|---|---|
| `/deals` | `src/app/ops/portal/sales/page.tsx` (×2), `src/app/ops/portal/sales/briefing/page.tsx` | `/ops/sales/pipeline` |
| `/deals/new` | `src/app/ops/portal/sales/page.tsx` | `/ops/sales/deals/new` (no such page exists either — only `[id]`) |
| `/quotes` | `src/app/ops/portal/sales/page.tsx`, `src/app/ops/portal/sales/briefing/page.tsx` | `/ops/quotes` |
| `/reports` | `src/app/ops/portal/sales/page.tsx` | `/ops/reports` |
| `/ops/sales/deals` | `src/app/ops/sales/page.tsx` | `/ops/sales/pipeline` (only `/ops/sales/deals/[id]` exists; no list page) |
| `/ops/takeoffs` | `src/app/ops/portal/estimator/page.tsx` | `/ops/takeoff-tool` or `/ops/takeoff-review` |
| `/dashboard/communities` | `src/app/aegis-home/page.tsx` | unclear — `dashboard/projects` likely |
| `/api/ops/pm/today` | `src/app/ops/today/TodayDashboard.tsx` | API route, not a page (FP) |
| `/catalog.html` | `src/app/ops/customer-catalog/page.tsx` | `public/catalog.html` exists (FP) |
| `/images/logos/abel-logo.png` | `src/app/layout.tsx` | `public/images/logos/abel-logo.png` exists (FP) |

**Root cause pattern**: the Sales Portal (`/ops/portal/sales/*`) and the legacy `/ops/sales` dashboard were built referring to a flat top-level URL scheme (`/deals`, `/quotes`, `/reports`) that the rest of the app moved past. Six of the seven real dead links live in those two files.

**Recommended fix (Monday-blocker)**: edit `src/app/ops/portal/sales/page.tsx`, `src/app/ops/portal/sales/briefing/page.tsx`, `src/app/ops/sales/page.tsx`, `src/app/ops/portal/estimator/page.tsx`, and `src/app/aegis-home/page.tsx` to point `<Link>`s at the correct namespaced routes. Five-line patch each.

---

## HIGH — Dead Navigation (sidebar → page)

**None.** All 159 sidebar items map to a real `page.tsx`. The visual-wave kebab/slug refactor held.

---

## HIGH — Missing Barrel Exports

**None.** All 41 distinct symbols imported via `from '@/components/ui'` are exported by `src/components/ui/index.ts`. Sample symbols verified: `AIInsight`, `AnimatedNumber`, `Avatar`, `Badge`, `Button`, `Card`, `CardBody`, `CardDescription`, `CardHeader`, `CardTitle`, `DataTable`, `Dialog`, `EmptyState`, `HealthChip`, `InfoTip`, `Input`, `KPICard`, `Kbd`, `LiveDataIndicator`, `Modal`, `PageHeader`, `PresenceAvatars`, `Sheet`, `Skeleton`, `Sparkline`, `StatusBadge`, `StatusDot`, `Table*`, `Tabs`, `Timeline`.

Earlier scans flagged names like `FinancialYtdStrip`, `FinancialMonthTable`, `FinancialLineChart`, `YearQuarterControls`, `MiniStat`, `HBarChart`, `DonutChart`, `ProgressRing`. None are imported from the UI barrel — they live in `src/components/FinancialChart.tsx` and `src/app/ops/components/Charts.tsx`. Both files exist; both imports resolve. No build break.

---

## MEDIUM — Orphan Pages (60)

Pages that exist but have **no incoming `<Link>` and aren't in the sidebar**. Most are intentional (auth flows, dynamic routes, deep-links from drill-downs, role-restricted pages reached via the sidebar render filter, or print pages). Grouped:

### Probably-still-wanted (deep-linked or reachable via dynamic flows)

| Page | Why orphan-but-likely-OK |
|---|---|
| `/ops/admin/qr-tags` | Print/utility page; reachable via QR scanner |
| `/ops/admin/digest-preview` | Email-template preview, dev-tool only |
| `/ops/admin/data-repair` | Admin tool, reached via System Health card |
| `/ops/admin/ai-usage` | Admin metrics, reached from AI sections |
| `/ops/calendar` | Reachable from My Day / Material Calendar widgets (not in nav) |
| `/ops/today`, `/ops/my-book`, `/ops/command-center` | Dashboards reached via cards on `/ops` home |
| `/ops/finance/ytd`, `/ops/finance/command-center`, `/ops/executive/financial` | Linked via cards from `/ops/finance` and `/ops/executive` |
| `/ops/scan`, `/ops/live-map`, `/ops/homeowner-access` | Mobile/scanner entry points |
| `/ops/inventory/auto-reorder`, `/ops/inventory/forecast`, `/ops/inventory/transfers`, `/ops/inventory/valuation` | Drill-downs from `/ops/inventory` (verify the inventory hub links to all four) |
| `/ops/integrations/inflow`, `/ops/integrations/quickbooks` | Linked from `/ops/integrations` hub |
| `/ops/pm`, `/ops/pm/compare` | Reached via `/ops/portal/pm` Cards (verify) |
| `/ops/portal/sales/earnings`, `/ops/portal/sales/next-stop` | Sales-rep mobile flows |
| `/ops/purchasing/new` | "New PO" CTA page |
| `/ops/shortages`, `/ops/smartpo`, `/ops/substitutions`, `/ops/substitutions/requests` | Likely wired into MRP / Manufacturing flows; verify the manufacturing dashboard links through |
| `/dashboard/cart`, `/dashboard/notifications`, `/dashboard/templates`, etc. | Builder portal; the Builder side has its own (not-audited) navigation in `src/app/dashboard/layout.tsx` |
| `/admin/builders`, `/admin/hyphen`, `/admin/products`, `/admin/quotes`, `/admin/webhooks` | The legacy `/admin` portal — different shell from `/ops/admin/*` |

### Worth a closer look

- **`/ops/builder-health`** — listed in earlier roadmaps; sidebar has `/ops/customers/health` instead. One of these is dead code; verify and delete the loser.
- **`/ops/marketing/seo`** — sidebar has `/ops/marketing/campaigns` only; this page may be stranded.
- **`/ops/ai/agent-workflows`, `/ops/ai/operator`** — sidebar AI section has 7 entries but not these two. Either add them to the sidebar or retire them.
- **`/ops/crews/pricing`** — sidebar links `/ops/crews` but not `/crews/pricing`. Reachable via the crew page? Verify.
- **`/ops/setup-account`, `/ops/reset-password`** — auth-flow pages; the layout's `isAuthPage` check covers `/ops/login`, `/ops/forgot-password`, `/ops/reset-password` but not `/ops/setup-account`. If setup-account is still used (staff onboarding link), the layout will render the full ops shell around it — not necessarily wrong, just worth confirming intent.
- **`/portal/settings/branding`** — solitary page under `/portal/`; not wired to anything else.
- **`/sales/contracts`, `/sales/documents`, `/sales/login`** — top-level `/sales/*` route group separate from `/ops/sales/*`. Several pages there (`/sales/page.tsx`, `/sales/pipeline`, `/sales/deals`, `/sales/deals/[id]`) — appears to be a parallel sales surface, possibly legacy. Worth deciding if it's deprecated and removing, or wiring nav to it.
- **`/orders`, `/quick-order`, `/bulk-order`** — top-level customer-facing pages with no obvious entry point in the audited shells.
- **`/crew/briefing`** — `/crew` has its own portal; verify the briefing page is wired from `/crew/page.tsx`.

---

## Cosmetic / Minor

- **`<a href="/ops/...">` instead of `<Link>`** for internal routes — found in `src/app/ops/login/page.tsx` (forgot-password link), `src/app/ops/settings/page.tsx` (×2), `src/app/ops/procurement-intelligence/page.tsx` (×2), `src/components/HelpPanel.tsx` (`/ops/ai`), and `src/app/ops/jobs/map/page.tsx` (Mapbox popup HTML — these are inside an `innerHTML` string so they have to be `<a>`, FP). Total: 6 cosmetic. Each loses Next prefetch + client-side transitions but works. Not a launch blocker.
- **Hash/query suffixes** like `/ops/material-calendar?status=red`, `/ops/jobs?filter=unassigned`, `/ops/invoices?action=create` resolve correctly (the script strips `?…` before matching) — listed only to confirm we checked.

---

## Recommendations

### Monday-blocker (do before next deploy)

1. **Fix the 6 real dead links** in `/ops/portal/sales/*` and `/ops/sales/page.tsx` and `/ops/portal/estimator/page.tsx` and `/aegis-home/page.tsx`. These are user-visible 404s on tiles/buttons — embarrassing if a sales rep clicks them on Monday. (10-line patch across 5 files.)
2. **Decide on `/ops/sales/deals`** — either build a list page (`src/app/ops/sales/deals/page.tsx`) or change the link in `src/app/ops/sales/page.tsx` to `/ops/sales/pipeline`. Currently the bare `/ops/sales/deals` URL 404s while `[id]` works.

### Post-launch cleanup

3. **Reconcile `/ops/builder-health` vs `/ops/customers/health`** — pick one, delete the other.
4. **Decide fate of the parallel `/sales/*` route group** — if deprecated, remove its 6 pages; if active, add a sidebar section.
5. **Wire or retire `/ops/ai/agent-workflows`, `/ops/ai/operator`, `/ops/marketing/seo`** — currently buildable but unreachable.
6. **Replace internal `<a href>` with `<Link>`** in the 5 cosmetic spots above for prefetch consistency.
7. **Add a CI check** that runs this script (`scripts/_audit_ui.mjs`) against `main` and fails on new dead links — would have caught the `/deals` regression before it shipped.

### Healthy

- Sidebar is fully wired (0/159 dead).
- UI barrel exports complete (0 missing).
- TypeScript clean (`tsc --noEmit` exit 0).
- All chart and finance helper imports resolve to real files.
