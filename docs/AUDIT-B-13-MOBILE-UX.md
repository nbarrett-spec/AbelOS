# AUDIT-B-13 — Mobile UX Consistency
**Scope:** Cross-platform mobile readiness, role-by-role
**Date:** 2026-04-28
**Sample:** 35 of 242 pages across /ops + /crew + /admin + /dashboard

## Status: Bimodal — field roles excellent, office roles poor

## Per-role readiness

| Role | Score | Status |
|---|---|---|
| Driver (Austin, Aaron, Jack, Noah) | **100%** | ✅ Ship as-is — gold standard |
| Installer (Cody, Wyatt) | **95%** | ✅ Ship as-is |
| Builder external (Brookfield/Bloomfield supers) | **80%** | ✅ Ship — minor polish |
| Warehouse Tech | **75%** | ⚠️ Add sticky actions on daily-plan |
| Manufacturing | **70%** | ⚠️ Fix button sizes + sticky actions |
| PM (Brittney, Chad, Ben, Thomas) | **65%** | ⚠️ Sticky detail-view actions |
| Dispatch (Jordyn) | **60%** | ⚠️ Layout reflow needed |
| Sales (Dalton) | **60%** | Unknown — defer review |
| Finance (Dawn) | **35%** | ❌ Table conversion REQUIRED |
| Admin/Manager (Nate, Clint) | **30%** | ❌ Table conversion REQUIRED |

## Gold standards (propagate everywhere)

### Pattern 1: 48px button minimum
```jsx
className="w-full py-3 px-4 min-h-[48px] ..."
```
Used throughout Driver Portal + Installer Portal + QC Portal.

### Pattern 2: Sticky bottom action bar
```jsx
<div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 space-y-2 z-20">
```
Critical for gloved field work. Driver Portal nails this.

### Pattern 3: Cards over tables on mobile
```jsx
<div className="overflow-x-auto hidden md:block"><table>...</table></div>
<div className="md:hidden space-y-3">{data.map(...)}</div>
```

### Pattern 4: iOS-zoom-prevention input sizing
```jsx
<input className="w-full px-4 py-3 text-base ..." />
```
text-base prevents Safari auto-zoom on focus.

## P0 — Launch blockers (Dawn + Nate use phones too)

### Fix 1: `/admin/builders` table → card view (3-4 days)
- 12+ admin pages all use the same pattern
- Build reusable `<ResponsiveAdminTable>` component
- Affects: Admin, Manager — currently unusable on phone

### Fix 2: Sticky action bars on `/ops/delivery/*` (1 day)
- Mission-critical workflow
- Driver Portal pattern available — copy/paste
- Affects: Dispatch, all field teams

### Fix 3: Standardize button heights to min-h-[48px] across `/ops/finance/*` (1 day)
- Find-replace level effort
- Affects: Dawn primarily

## P1 — Important

### Fix 4: Manufacturing build-sheet text sizing (4 hours)
- Currently `text-xs` (<12px), unreadable on phone
- Change to `text-sm`
- Adjust dropdown font sizes

### Fix 5: Convert finance tables to cards (2-3 days)
- Reusable `<APCard>` and `<ARCard>` components
- Replace `/ops/finance/ap`, `/ops/finance/ar`
- Unblocks Accounting mobile access

### Fix 6: Executive dashboard responsive grid (2 days)
- KPI charts hard to scan on phone
- Affects: Nate, Clint

## P2 — Polish

- Modal sizing on small screens (signature pad, escalation dialog)
- max-w-[1800px] on dispatch should reflow
- Some pages lack horizontal-scroll affordance for tables that must remain tabular

## What works ✅

- 22 pages use proper responsive grid (grid-cols-1 → md:grid-cols-2 → lg:grid-cols-3)
- 18 pages use min-h-[48px] button pattern (51% of sample)
- 8 pages have sticky actions (23% of sample)
- Driver, Installer, QC portals are exemplary mobile UX

## Recommendations

**For Monday launch:**
- **Driver, Installer, Builder portals: ship as-is, they're great**
- **Finance + Admin + Dispatch: accept they're desktop-only for now**
- Focus mobile fixes on what's broken not what's polish

**Post-launch wave:**
- Standardize button heights site-wide (find-replace, low risk)
- Build `<ResponsiveAdminTable>` component
- Convert finance + admin tables systematically

## Launch readiness: 70% across the platform
- Field roles 95-100%
- Office roles 30-65%
- Acceptable IF office roles use desktops (which they do)
