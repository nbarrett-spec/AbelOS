# Aegis Visual Improvement Plan — Claude Code Handoff

**Date:** 2026-04-24
**Author:** Cowork session (Nate Barrett)
**Status:** Audit complete, prioritized, ready for implementation
**Scope:** Ops portal (staff) + Login/public pages
**Direction:** Refinement, not redesign — preserve the blueprint drafting-room feel
**Risk:** Visual-only changes — no routing, data model, or API modifications

---

## CRITICAL RULES FOR IMPLEMENTATION

1. **DO NOT** modify any API routes, middleware logic, database queries, or Prisma schema
2. **DO NOT** change any routing, redirects, or auth logic
3. **DO NOT** rename or move files — only modify content within existing files
4. **DO NOT** remove any data-fetching logic, useEffect hooks that fetch data, or polling intervals
5. **DO** commit after completing each tier with message: `visual: tier N — <short description>`
6. **DO** run `npx tsc --noEmit` after each tier to verify zero type errors
7. **DO** test in both light and dark mode (check CSS variable usage)
8. **DO** preserve all existing `prefers-reduced-motion` media queries
9. When replacing hardcoded hex values, refer to the token map in the "Reference" section below
10. When in doubt about a token mapping, keep the existing value rather than guessing wrong

---

## Reference: Key file paths

### Styles and config
- `src/app/globals.css` — CSS variable definitions, token layers, glass effects, paper-grain texture
- `tailwind.config.ts` — Extended theme: colors, keyframes, animations, spacing, fonts

### Auth pages (Tier 1)
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/forgot-password/page.tsx`
- `src/app/(auth)/reset-password/page.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/app/ops/setup-account/page.tsx`

### Core UI components
- `src/components/ui/Card.tsx` — Card, CardHeader, CardTitle, CardDescription, CardBody
- `src/components/ui/Badge.tsx` — status badges with variant system
- `src/components/ui/Button.tsx` — all button variants including danger
- `src/components/ui/KPICard.tsx` — metric display with icon, delta, sparkline
- `src/components/ui/Sparkline.tsx` — mini SVG trend lines with forecast overlay
- `src/components/ui/StatusDot.tsx` — colored dots with pulse variants (active, success, alert, live)
- `src/components/ui/NumberFlow.tsx` — animated digit-roll with gold flash on change
- `src/components/ui/Progress.tsx` — horizontal bar + StepProgress multi-step flow
- `src/components/ui/PageHeader.tsx` — standardized page header with title + description + action slot
- `src/components/ui/Skeleton.tsx` — loading skeleton placeholder
- `src/components/ui/EmptyState.tsx` — empty data state with icon + message
- `src/components/ui/StatusBar.tsx` — system status footer with health polling
- `src/components/ui/HealthChip.tsx` — health endpoint poller with latency display
- `src/components/ui/DataTable.tsx` — standard data table component
- `src/components/ui/ToastContainer.tsx` — notification toasts

### Existing but underused components (wire these up, don't rebuild)
- `src/components/ui/CommandMenu.tsx` — Cmd+K palette (exists, used in 1 file — deploy globally)
- `src/components/ui/DensityToggle.tsx` — compact/default/comfortable toggle (exists, used in 1 file)
- `src/components/ui/LiveDataIndicator.tsx` — "LIVE" badge with pulse (exists, used in 1 file)
- `src/components/ui/ScrollReveal.tsx` — scroll-triggered entrance animation (exists, used in 0 files)
- `src/components/ui/ShortcutsOverlay.tsx` — keyboard shortcut display (exists, used in 1 file)
- `src/components/ui/RecentActivityDrawer.tsx` — activity feed drawer (exists, used in 1 file)
- `src/components/ui/AnimatedCounter.tsx` — count-up animation (exists, used in 2 files)
- `src/components/ui/AnimatedNumber.tsx` — number animation (exists, used in 0 files)
- `src/components/ui/LiveClock.tsx` — real-time clock (exists, used in 1 file)
- `src/components/ui/TabBarInk.tsx` — animated tab indicator (exists, used in 1 file)

### Feature components
- `src/components/FinancialChart.tsx` — SVG line chart (Revenue, COGS, Gross Profit)
- `src/components/SystemPulse.tsx` — system health + alerts poller
- `src/components/Navbar.tsx` — top navigation bar

### Key ops pages (highest traffic, fix these first)
- `src/app/ops/executive/page.tsx` — executive dashboard (Nate's main screen)
- `src/app/ops/executive/NucStatusCard.tsx` — NUC engine status card
- `src/app/ops/jobs/page.tsx` — jobs list (densest hardcoded hex)
- `src/app/ops/finance/page.tsx` — financial overview
- `src/app/ops/collections/page.tsx` — AR/collections
- `src/app/ops/orders/page.tsx` — order management
- `src/app/ops/inventory/page.tsx` — inventory management
- `src/app/ops/receiving/page.tsx` — receiving dock
- `src/app/ops/purchasing/page.tsx` — purchase orders
- `src/app/ops/layout.tsx` — ops portal layout wrapper (sidebar + content area)
- `src/app/ops/today/page.tsx` — daily dashboard
- `src/app/ops/kpis/page.tsx` — KPI dashboard

### All ops pages (86 total — full list for Tier 2 sweep)
Run `find src/app/ops -maxdepth 2 -name "page.tsx" | sort` for the complete list.

---

## Reference: Token mapping for hex replacement (Tier 2)

When replacing arbitrary Tailwind hex values, use these mappings. The left column is what you'll find in the code; the right column is the semantic token to replace it with.

### Background colors
| Hardcoded | Replace with | Notes |
|-----------|-------------|-------|
| `bg-[#050d16]` | `bg-canvas` | Darkest background layer |
| `bg-[#0a1a28]` | `bg-surface` | Primary surface |
| `bg-[#0f2a3e]` | `bg-surface` or `bg-surface-elevated` | Context-dependent |
| `bg-[#132d42]` | `bg-surface-elevated` | Elevated card background |
| `bg-[#1a3a50]`, `bg-[#1a3d56]` | `bg-surface-elevated` | Elevated elements |
| `bg-[#f5f2eb]` | `bg-canvas` | Light mode canvas |

### Text colors
| Hardcoded | Replace with | Notes |
|-----------|-------------|-------|
| `text-[#f5f1e8]` | `text-fg` | Primary text |
| `text-[#8a9aaa]` | `text-fg-muted` | Secondary text |
| `text-[#5a6a7a]` | `text-fg-subtle` | Tertiary text |
| `text-[#C6A24E]`, `text-[#c6a24e]` | `text-signal` or `text-accent` | Gold accent/signal |
| `text-[#a88a3a]` | `text-signal-dark` | Dark gold |
| `text-[#e4c77a]` | `text-signal-light` | Light gold |

### Border colors
| Hardcoded | Replace with | Notes |
|-----------|-------------|-------|
| `border-[#1a3a50]` | `border-border` | Standard border |
| `border-[#C6A24E]`, `border-[#c6a24e]` | `border-signal` | Gold accent border |
| `border-[rgba(198,162,78,0.08)]` | `border-border` | Default gold-tinted border |
| `border-[rgba(198,162,78,0.18)]` | `border-border-strong` | Emphasis border |

### Hover states
| Hardcoded | Replace with |
|-----------|-------------|
| `hover:bg-gray-50` | `hover:bg-row-hover` or `hover:bg-surface-muted` |
| `hover:bg-gray-100` | `hover:bg-surface-muted` |
| `hover:bg-slate-50` | `hover:bg-row-hover` |

> **Important:** Before doing bulk replacements, read `globals.css` to verify these token names exist in the actual CSS variable definitions. The names above are based on the audit — confirm they match exactly.

---

## Reference: Current design system values

### Surface elevation (dark mode)
- Canvas: `#050d16` (deepest)
- Surface: `#0a1a28`
- Surface-elevated: `#1a3d56`
- Surface-floating: **NEW — add as `#1f4868`** (Tier 3.1)

### Text hierarchy
- `fg`: `#f5f1e8` (primary)
- `fg-muted`: `#8a9aaa` → **bump to `#96a8b8`** (Tier 3.4)
- `fg-subtle`: `#5a6a7a` → **bump to `#6b7d8e`** (Tier 3.4)

### Signal colors (gold)
- `signal-dark`: `#a88a3a`
- `signal`: `#c6a24e`
- `signal-light`: `#e4c77a`

### Border opacity levels
- Standard: gold at 8% → **bump to 12%** (Tier 3.2)
- Strong: gold at 18% (keep)
- Row hover: gold at 4% (keep)

---

## Tier 1 — Auth page unification

*5 items · all low risk · commit as `visual: tier 1 — auth page unification`*

**Files to modify:**
- `src/app/(auth)/login/page.tsx` (reference — this is the "good" one)
- `src/app/(auth)/forgot-password/page.tsx` (needs full restyle)
- `src/app/(auth)/reset-password/page.tsx` (needs full restyle)
- `src/app/(auth)/signup/page.tsx` (minor alignment)
- `src/app/ops/setup-account/page.tsx` (needs restyle)

**1.1 Unify auth page gradient direction.** Login uses cool blue gradient, forgot/reset use warm gold, setup-account uses dark glassmorphism. Use the login page as the reference — apply the same background gradient, card style, and layout pattern to all 5 auth pages.

**1.2 Replace inline styles on forgot/reset pages.** Forgot-password and reset-password pages use 100% inline `style={{}}` with zero design tokens. Convert all inline styles to Tailwind utility classes using the token system. Match the class patterns from the login page.

**1.3 Add focus states to all auth form inputs.** Add `focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:outline-none` (or whatever focus ring pattern the login page uses) to every `<input>` on all auth pages.

**1.4 Add password strength indicator.** On `reset-password/page.tsx` and `ops/setup-account/page.tsx`, add a password strength bar below the password input. Use the existing `Progress` component (`src/components/ui/Progress.tsx`) with color progression: red (weak) → amber (fair) → green (strong). Check strength with: length >= 8, has uppercase, has number, has special char.

**1.5 Standardize auth card dimensions and spacing.** All auth cards should use the same `max-w-md` (or whatever the login page uses), same padding (`p-8` or similar), same `rounded-xl`, same border treatment.

---

## Tier 2 — Token enforcement (the big cleanup)

*6 items · high impact · commit as `visual: tier 2 — token enforcement`*

**This is the largest tier. Consider splitting into sub-commits by page group.**

**2.1 Replace arbitrary Tailwind hex values across the codebase.** Use the token mapping table above. Run `grep -rn 'bg-\[#\|text-\[#\|border-\[#' src/app/ src/components/` to find all instances. Replace each with the corresponding semantic token. Start with the high-traffic ops pages listed above, then sweep the rest.

**2.2 Convert inline style color/border/bg objects to tokens.** Search for `style={{` across `src/app/ops/` and `src/components/`. For each inline style that sets `color`, `backgroundColor`, `borderColor`, or `border`, replace with the equivalent Tailwind class. Leave non-color inline styles (width, height, position, transform) as-is — those are often dynamic and fine as inline.

**2.3 Standardize button danger gradient.** In `src/components/ui/Button.tsx`, find the danger variant. If it uses a hardcoded gradient (`bg-gradient-to-*` with hex values), replace with semantic danger tokens (`bg-data-negative`, `text-data-negative-fg`, etc.).

**2.4 Fix Badge letterSpacing inline override.** In `src/components/ui/Badge.tsx`, find any inline `style={{ letterSpacing: ... }}` and replace with Tailwind tracking utility (`tracking-wide` or `tracking-wider`).

**2.5 Clean up Jobs page.** `src/app/ops/jobs/page.tsx` has the densest hardcoded hex. Do a focused pass converting all arbitrary colors to tokens.

**2.6 Clean up Finance page.** `src/app/ops/finance/page.tsx` — replace `#C6A24E` with `text-signal` and `#0f2a3e` with `bg-surface`.

---

## Tier 3 — Contrast and visual depth

*5 items · commit as `visual: tier 3 — contrast and depth`*

**Files to modify:**
- `src/app/globals.css` (token definitions)
- `tailwind.config.ts` (if shadow utilities are defined there)

**3.1 Add fourth surface elevation layer.** In `globals.css`, add `--surface-floating: #1f4868` to the dark mode variables (and a corresponding light mode value like `#ffffff` or `#fafaf8`). Add `surface-floating` to `tailwind.config.ts` colors. Use this new token on `CommandMenu.tsx`, `Dialog.tsx`, `Modal.tsx`, and `Sheet.tsx`.

**3.2 Increase border contrast.** In `globals.css`, find the border opacity variable (likely `rgba(198, 162, 78, 0.08)`). Bump the standard card border to `0.12` (12%). Keep the strong border at `0.18`. Update the CSS variable — this will cascade to all components using the token.

**3.3 Add inner glow to cards.** In `src/components/ui/Card.tsx`, add to the base card class: `shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]` (or add it to `.panel` in `globals.css`). Very subtle — just a top edge highlight.

**3.4 Boost secondary text contrast.** In `globals.css`, find the dark mode `--fg-muted` value (#8a9aaa) and change to `#96a8b8`. Find `--fg-subtle` (#5a6a7a) and change to `#6b7d8e`. This affects the entire app in one change.

**3.5 Refine elevation shadows.** In `globals.css` or `tailwind.config.ts`, find the elevation shadow definitions (`--elev-1`, `--elev-2`, etc. or `boxShadow` in tailwind config). Replace single heavy shadows with two-layer: `0 1px 2px rgba(5, 13, 22, 0.20), 0 4px 12px rgba(5, 13, 22, 0.10)` for elev-1, and scale up for elev-2/3/4.

---

## Tier 4 — Ops page consistency

*8 items · commit as `visual: tier 4 — ops page consistency`*

**4.1 Adopt Card component everywhere.** Search for `<div className="...border...rounded...` patterns in ops pages that recreate what Card already does. Replace with `<Card>`, `<CardHeader>`, `<CardBody>` imports from `@/components/ui`. Focus on executive, warehouse, receiving, and purchasing pages first.

**4.2 Standardize loading states.** The `Skeleton` component exists but is only used in 5 pages. For every ops page that has a loading state (check for `isLoading`, `loading`, or conditional renders showing "Loading..."), replace with the `Skeleton` component or a `Skeleton`-based layout.

**4.3 Add empty states.** The `EmptyState` component exists but is only used in 8 pages. For every ops page that renders a data table or list, add an `EmptyState` fallback when the data array is empty. Use contextually appropriate icons from lucide-react.

**4.4 Normalize page headers.** `PageHeader` component exists. Search for pages using ad-hoc `<h1>` or `<h2>` as page titles and replace with `<PageHeader title="..." description="..." />`. All 86 ops pages should use this component.

**4.5 Fix typography weight inconsistency.** Search for `font-bold` and `font-semibold` across ops pages. Normalize: headings should use `font-medium` (500), body should use `font-normal` (400), and only critical emphasis should use `font-semibold` (600). Never use `font-bold` (700) outside of the brand logo.

**4.6 Consistent sidebar active state.** In `src/app/ops/layout.tsx` (or whatever renders the sidebar nav), ensure the active nav item uses a consistent style — `bg-surface-elevated` background + `text-signal` text + `border-l-2 border-signal` left accent. Remove any per-page overrides.

**4.7 Standardize table row hover.** Replace all `hover:bg-gray-50` (268 instances) with `hover:bg-row-hover`. Run: `grep -rn 'hover:bg-gray-50' src/` to find them all.

**4.8 Normalize badge color mapping.** Decide on one canonical mapping and apply everywhere:
- "active" / "online" / "paid" / "completed" → `variant="success"`
- "pending" / "in-progress" / "processing" → `variant="warning"`
- "cancelled" / "failed" / "overdue" / "error" → `variant="danger"`
- "draft" / "inactive" / "archived" → `variant="neutral"`

---

## Tier 5 — Live elements and dynamic content

*7 items · commit as `visual: tier 5 — live elements`*

**5.1 Count-up animation on KPI page load.** `AnimatedCounter` exists (used in 2 files) and `AnimatedNumber` exists (used in 0 files). Deploy one of these to all KPI cards on the executive dashboard (`src/app/ops/executive/page.tsx`). Wrap the main metric value in the animated component with a staggered delay per card (0ms, 100ms, 200ms, 300ms).

**5.2 Deploy RecentActivityDrawer.** `RecentActivityDrawer` exists but is only used in 1 file. Add a trigger button (or auto-open) on the executive dashboard. If it needs a data source, connect it to `/api/ops/executive/dashboard` or create a simple wrapper.

**5.3 Sparkline draw animation.** In `src/components/ui/Sparkline.tsx`, add a CSS animation to the SVG `<path>` element: set initial `stroke-dasharray` and `stroke-dashoffset` equal to the path length, then animate `stroke-dashoffset` to 0 over 600ms with `ease-out`. Add this as an optional `animate` prop (default true).

**5.4 Deploy LiveDataIndicator.** `LiveDataIndicator` exists but is used in only 1 file. Add it next to every section title on the executive dashboard that auto-refreshes (NUC status, alerts, pipeline). It should show "LIVE" with a pulsing dot.

**5.5 Interactive FinancialChart tooltips.** In `src/components/FinancialChart.tsx`, add mouse hover tracking to the SVG. On mousemove, draw a vertical crosshair line at the cursor X position and show a positioned tooltip div with the month name and values for each data series. On mouseleave, hide the crosshair and tooltip.

**5.6 Circular progress for collections.** In `src/app/ops/collections/page.tsx`, find the collection rate / AR percentage displays. Replace flat progress bars with an SVG circular gauge: 80px diameter ring, `stroke-dasharray` based on percentage, animated with `transition: stroke-dashoffset 800ms ease-out`. Show percentage text centered inside the ring.

**5.7 Table row stagger animation.** In `src/components/ui/DataTable.tsx` (or in the executive dashboard's builder table), add `animate-enter` class to each `<tr>` with incrementing `animate-enter-delay-*` classes (these already exist in tailwind config). Cap at 10 rows of animation to avoid performance issues.

---

## Tier 6 — Background and atmosphere

*4 items · commit as `visual: tier 6 — background atmosphere`*

**6.1 Page header gradient strip.** In `src/app/ops/layout.tsx` (or the content wrapper), add a pseudo-element or div at the top of the content area: `background: linear-gradient(to bottom, rgba(10, 26, 40, 0.5), transparent)` over the first 200px. Use `pointer-events: none` and `position: absolute`.

**6.2 Refine paper-grain texture.** In `globals.css`, find the `::before` or `::after` pseudo-element that applies the paper-grain SVG noise texture. Bump opacity from `0.04` to `0.055`.

**6.3 Sidebar depth treatment.** In the sidebar component (check `src/app/ops/layout.tsx`), make the sidebar background 1 shade darker than the content area. Add a right border with: `border-right: 1px solid rgba(198, 162, 78, 0.06)` and optionally a very subtle `box-shadow: 1px 0 8px rgba(5, 13, 22, 0.15)` on the right edge.

**6.4 Drafting-line section dividers.** Create a CSS class `.divider-draft` in `globals.css`: `border-top: 1px dashed rgba(198, 162, 78, 0.12)` with `position: relative` and `::before`/`::after` pseudo-elements that draw small 6px perpendicular ticks at each end. Apply to section breaks on the executive dashboard between the KPI row, chart area, and table area.

---

## Tier 7 — Animation and interaction polish

*6 items · commit as `visual: tier 7 — animation polish`*

**7.1 Page transition fade-in.** In `src/app/ops/layout.tsx`, wrap the `{children}` slot in a div with class `animate-enter` (which should map to your existing `slideUp` or `fadeIn` keyframe at 200ms). This gives every page a subtle entrance.

**7.2 Hover pattern standardization.** Run `grep -rn 'hover:bg-gray-50\|hover:bg-slate-50\|hover:bg-gray-100' src/` and replace all with `hover:bg-row-hover` (or `hover:bg-surface-muted` if not on a table row). This was partially covered in Tier 4.7 — catch any remaining.

**7.3 KPI card micro-interaction.** In `src/components/ui/KPICard.tsx`, add to the wrapper: `transition-transform duration-150 hover:scale-[1.01]`. Small, subtle, tactile.

**7.4 Smooth panel transitions.** Search for expandable/collapsible panels (Accordion-like patterns). Replace any `{isOpen && <div>...` snap-renders with CSS grid height transition: wrapper gets `display: grid; grid-template-rows: 0fr; transition: grid-template-rows 300ms ease` → open state sets `grid-template-rows: 1fr`. Inner div needs `overflow: hidden; min-height: 0`.

**7.5 Toast entrance animation.** In `src/components/ui/ToastContainer.tsx`, ensure new toasts enter with `animate-enter` (slide up + fade in). If toasts currently just appear, add the animation class.

**7.6 Button press feedback.** In `src/components/ui/Button.tsx`, add to the base button class: `active:scale-[0.98] transition-transform duration-75`. Applies to all variants automatically.

---

## Tier 8 — Premium polish and delight

*8 items · commit as `visual: tier 8 — premium polish`*

**8.1 Deploy CommandMenu globally.** `CommandMenu.tsx` already exists. Import and render it in `src/app/ops/layout.tsx` so it's available on every ops page. Verify it responds to Cmd+K / Ctrl+K. If it needs page/route data, wire it up to the sidebar nav items.

**8.2 Gold accent on active section.** On the executive dashboard, when a section is hovered or focused, add a `border-l-2 border-signal` with `transition-all duration-200`. Apply to the Card wrapper of each dashboard section.

**8.3 Blueprint-line skeleton loaders.** In `src/components/ui/Skeleton.tsx`, add a variant prop `variant="blueprint"`. The blueprint variant uses `border: 1px dashed rgba(100, 160, 220, 0.2)` instead of solid fill, with a subtle pulsing border animation. Default variant stays as-is.

**8.4 Notification bell.** In `src/components/Navbar.tsx`, add a bell icon (from lucide-react: `Bell`) that shows the count from `SystemPulse`'s alert data. Badge count uses `Badge` component with `variant="danger"` and `size="xs"`. Click opens a dropdown (or the `RecentActivityDrawer`). Wrap count changes with a `scale-in` animation.

**8.5 Glass morphism refinement.** In `globals.css`, update `.card-glass`: change `backdrop-filter: saturate(1.4) blur(16px)` to `saturate(1.3) blur(12px)` (tighter). Add `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05)` for the inner highlight.

**8.6 Chart color palette.** Define 6 chart colors as CSS variables in `globals.css`: `--chart-1` through `--chart-6`, derived from the blueprint palette. Example: `--chart-1: #4a90c4` (blue), `--chart-2: #c6a24e` (gold), `--chart-3: #2f7c3a` (green), `--chart-4: #9b3826` (red), `--chart-5: #6b5b95` (purple), `--chart-6: #3e4861` (slate). Apply in `FinancialChart.tsx` and any other chart components.

**8.7 Dark mode polish pass.** Walk through every ops page in dark mode. Fix any remaining:
- White or light-gray text on light backgrounds
- Chart elements using hardcoded colors that don't adapt
- Badge backgrounds that lose contrast
- Table header/cell backgrounds that clash

**8.8 Shimmer animation on Skeleton.** In `globals.css` or the `Skeleton` component, add a shimmer keyframe if not present: `@keyframes shimmer { 0% { background-position: -200px 0 } 100% { background-position: 200px 0 } }`. Apply to `.skeleton` class: `background: linear-gradient(90deg, var(--surface) 25%, var(--surface-elevated) 50%, var(--surface) 75%); background-size: 400px 100%; animation: shimmer 1.5s ease-in-out infinite`.

---

## Tier 9 — Customization and theming

*4 items · commit as `visual: tier 9 — theming`*

**9.1 Theme presets.** In `globals.css`, define two additional `:root[data-theme="midnight"]` and `:root[data-theme="warm-oak"]` blocks that override the CSS variables. Midnight: deeper blacks, cooler blues, higher contrast. Warm Oak: `#2a1f14` canvas, `#3d2e1f` surface, `#c4956a` signal (warm copper instead of gold). Default theme is "blueprint" (current values, no attribute needed).

**9.2 Deploy DensityToggle.** `DensityToggle.tsx` already exists. Add it to the user settings page (`src/app/ops/settings/page.tsx` or `profile/page.tsx`). Verify it sets the `data-density` attribute on `<html>`. Test that compact/default/comfortable modes visually change spacing.

**9.3 Font-size scaling.** Add a select/radio group in settings: "Text size: Small (90%) / Default (100%) / Large (110%)". On change, set `document.documentElement.style.fontSize` to `14.4px` / `16px` / `17.6px` and save to localStorage key `aegis-font-size`. On page load, read and apply before render (add script to `src/app/layout.tsx`).

**9.4 Persist preferences.** When a user changes theme, density, or font size, POST to an API endpoint (or use existing staff profile update) to save `{ theme, density, fontSize }` in the `StaffAccount.meta` JSONB field. On login/page load, read from the profile and apply. Add a `<script>` in `layout.tsx` that reads from localStorage first (instant, no FOUC) and the server value overwrites if different.

---

## Tier 10 — UX and interaction upgrades

*7 items · commit as `visual: tier 10 — ux upgrades`*

**10.1 Deploy ShortcutsOverlay.** `ShortcutsOverlay.tsx` exists. Import in `src/app/ops/layout.tsx`. Verify it responds to `?` key. If it needs shortcut data, populate with: `J/K` = navigate rows, `E` = edit, `Esc` = close, `Cmd+K` = command palette, `/` = focus search.

**10.2 Breadcrumb trail.** Create a `Breadcrumb` component (or find if one exists). Add to pages deeper than 2 levels: job detail, order detail, PO detail, account detail. Use the route segments to auto-generate: `Ops > Jobs > Job #4821`. Style: `text-fg-muted text-sm` with `ChevronRight` separators.

**10.3 Scroll-linked header shadow.** In `src/app/ops/layout.tsx` (or the Navbar component), add a scroll listener that adds/removes a shadow class on the header: `useEffect` with `window.addEventListener('scroll', ...)`. When `scrollY > 20`, add `shadow-md`; when at top, remove it. Use `transition-shadow duration-200`.

**10.4 KPI card scroll-to-section.** On the executive dashboard, make each KPI card clickable. Add `onClick={() => document.getElementById('section-collections')?.scrollIntoView({ behavior: 'smooth' })}` (adjust IDs to match actual section containers). Add `cursor-pointer` to KPI card wrapper.

**10.5 Contextual empty state icons.** Update `EmptyState` usage across pages with contextually appropriate icons:
- Jobs: `Briefcase` icon, "No jobs to display"
- Orders: `ShoppingCart` icon, "No orders found"
- Deliveries: `Truck` icon, "No deliveries scheduled"
- Inventory: `Package` icon, "No items match your filters"
- Collections: `Wallet` icon, "All caught up — no overdue invoices"

**10.6 Print stylesheet.** In `globals.css`, add `@media print { ... }` rules: hide sidebar (`nav { display: none }`), hide header/footer, set `body { background: white; color: black }`, set content area to `max-width: 100%`, remove shadows and borders, ensure tables have visible borders for printing. Apply to executive, finance, and collections pages.

**10.7 Responsive breakpoints.** Add responsive classes to key layouts:
- Sidebar: `hidden lg:block` (collapse below 1024px), add a hamburger toggle
- KPI grid: already responsive (check `lg:grid-cols-4` pattern)
- Data tables: wrap in `overflow-x-auto` for horizontal scroll on small screens
- Cards: use `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` patterns

---

## Post-implementation checklist

After all tiers are complete:
- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] All auth pages visually match (same gradient, card style, spacing)
- [ ] `grep -rn 'bg-\[#' src/app/ src/components/ | wc -l` returns < 50 (down from 822)
- [ ] Executive dashboard loads with count-up animation and sparkline draw
- [ ] Cmd+K opens command palette on any ops page
- [ ] Dark mode: walk through executive, jobs, finance, collections — no contrast issues
- [ ] Sidebar has visible depth separation from content area
- [ ] All data tables show EmptyState when data array is empty
- [ ] All ops pages use PageHeader component
- [ ] Toast notifications animate in (not snap-appear)
- [ ] Buttons have active press feedback (scale down on click)
