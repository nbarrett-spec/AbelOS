# Exploded Door Animation — Claude Code Handoff

**Date:** 2026-04-24
**Status:** Component created, integration needed in 2 pages
**Risk:** Visual-only additions — no data model, API, or routing changes
**Component:** `src/components/ExplodedDoor.tsx` (CREATED — ready to import)

---

## What this is

Interactive animated SVG of a 3080 2-Panel square top prehung door that explodes into its individual components (casing header, head jamb, hinge jamb, strike jamb, door stops, 3 hinges, door slab) with staggered animation and labels. All dimensions match Abel's actual product specs.

Two variants:
- **`hero`** — large, auto-plays when scrolled into view (IntersectionObserver at 40%), has Explode/Assemble buttons, click-to-toggle
- **`compact`** — smaller, click-to-toggle, no buttons, used as inline visual reference

---

## Integration 1: Home page hero

**File:** `src/app/page.tsx`

**Task:** Add the exploded door as the hero visual, replacing the current amber gradient orb.

### Steps

1. Add import at top of file:
```tsx
import ExplodedDoor from '@/components/ExplodedDoor'
```

2. In the hero section (around line 75-125), replace the gradient orb div:
```tsx
{/* DELETE this block (the orb): */}
{mounted && (
  <div
    className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-gradient-to-r from-amber-500/30 via-orange-500/20 to-amber-600/30 rounded-full blur-3xl orb-animation"
    style={{ transform: 'translate(-50%, -50%)' }}
  />
)}
```

3. Restructure the hero to be a two-column layout. Replace the entire hero `<section>` content with:
```tsx
<section className="relative min-h-screen flex items-center justify-center px-6 pt-24 pb-20 overflow-hidden">
  <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
    {/* Left: Text content */}
    <div className="text-center lg:text-left">
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8">
        <div className="w-2 h-2 rounded-full bg-signal-hover animate-pulse" />
        <span className="text-sm font-medium text-signal-hover">
          AI-Powered Blueprint Intelligence
        </span>
      </div>

      <h1 className="text-5xl md:text-6xl font-bold text-white leading-tight mb-4">
        Upload a Blueprint.
      </h1>
      <h2 className="text-5xl md:text-6xl font-bold text-signal-hover leading-tight mb-8">
        Get a Quote in Minutes.
      </h2>

      <p className="text-lg text-white/60 max-w-xl mb-12 leading-relaxed">
        Abel's AI reads your blueprints, generates accurate material takeoffs, and produces instant quotes—with your custom pricing and flexible payment terms.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
        <Link
          href="/apply"
          className="bg-signal hover:bg-signal-hover text-black font-semibold px-8 py-4 rounded-xl text-lg transition-colors duration-200 shadow-lg shadow-amber-500/20"
        >
          Apply for Builder Account
        </Link>
        <a
          href="#how-it-works"
          onClick={handleNavigation}
          className="border border-white/20 hover:bg-white/5 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-all duration-200"
        >
          See How It Works
        </a>
      </div>
    </div>

    {/* Right: Exploded door */}
    <div className="hidden lg:block">
      <ExplodedDoor variant="hero" autoPlay loop loopInterval={6000} />
    </div>
  </div>
</section>
```

4. Remove the `orbPulse` keyframe from the `<style>` block (no longer needed). Keep `gradient-shift` and `smooth-scroll` if used elsewhere.

5. The `mounted` state + `useEffect` can also be removed since the orb is gone. `ExplodedDoor` handles its own mount state internally.

---

## Integration 2: BOM page

**File:** `src/app/ops/manufacturing/bom/page.tsx`

**Task:** Add the compact exploded door as a visual reference in the BOM page, positioned in the empty state or as a sidebar visual.

### Steps

1. Add import:
```tsx
import ExplodedDoor from '@/components/ExplodedDoor'
```

2. **Option A — Empty state enhancement.** When no parent BOM is selected (`!selectedParent`), show the door as a visual alongside the empty state:
```tsx
{!selectedParent && (
  <div className="flex flex-col items-center gap-6 py-8">
    <ExplodedDoor variant="compact" autoPlay />
    <div className="text-center">
      <p className="text-fg-muted text-sm">Select a parent product to view its bill of materials</p>
      <p className="text-fg-subtle text-xs mt-1">Click the door to see component breakdown</p>
    </div>
  </div>
)}
```

3. **Option B — Sidebar visual.** If the page uses a two-column layout with a product list on the left and BOM detail on the right, add the door as a compact visual in the right column header area when a door-category product is selected:
```tsx
{selectedParent && selectedParent.category?.includes('DOOR') && (
  <div className="mb-6">
    <ExplodedDoor variant="compact" />
  </div>
)}
```

**Recommendation:** Start with Option A — it works without any conditional product-category logic.

---

## Component API reference

```tsx
<ExplodedDoor
  variant="hero"      // "hero" (large) | "compact" (small)
  autoPlay={true}     // Auto-explode on scroll (hero) or mount (compact)
  loop={true}         // Auto-cycle explode/assemble
  loopInterval={6000} // Cycle interval in ms
  className=""        // Additional wrapper classes
/>
```

---

## Verification

- [ ] Home page: door animates on scroll into view
- [ ] Home page: Explode/Assemble buttons work
- [ ] Home page: click on door toggles state
- [ ] Home page: loop mode cycles every 6s
- [ ] Home page: responsive — door hidden below `lg` breakpoint (text goes full-width)
- [ ] Home page: labels fade in when exploded, fade out when assembled
- [ ] BOM page: compact door shows in empty state
- [ ] BOM page: click toggles explode/assemble
- [ ] Both pages: works in dark mode (uses CSS variable fallbacks)
- [ ] Both pages: works in light mode
- [ ] `npx tsc --noEmit` passes

---

## Commit message

```
feat: add interactive exploded door animation component

New ExplodedDoor component with hero and compact variants.
SVG animation of 3080 2-panel door with all components
(casing, jambs, stops, hinges, slab) separating with
staggered timing and spec labels. For home page hero
and BOM page visual reference.
```
