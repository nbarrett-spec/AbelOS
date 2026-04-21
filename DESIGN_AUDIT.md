# DESIGN_AUDIT.md — Aegis v2 "The Drafting Room"

> Phase 0 audit. Generated 2026-04-20.
> Repo: `abel-builder-platform` · 1,081 .tsx/.ts files · 7 .css files

---

## 1. Current Token Architecture

The existing three-layer system is **sound**. Architecture stays; personality gets replaced.

| Layer | Location | Variables | Status |
|---|---|---|---|
| **Primitive** | `:root` in `globals.css` | 55 (stone, walnut, amber, data-green, data-red, forecast — 9 shades each) | Keep structure, replace values with OKLCH navy/gold/cream/walnut |
| **Semantic** | `:root` + `html.dark` in `globals.css` | ~60 (canvas, surface, fg, border, accent, brand, data-*, forecast) | Remap to Drafting Room palette |
| **Component** | `@layer components` in `globals.css` | 30+ classes (panel, btn, badge, datatable, metric, etc.) | Restyle, don't restructure |

**Tailwind config** (`tailwind.config.ts`) — 204 lines. Colors point to CSS vars. No hard-coded hex in component code (clean). Config also defines: `abel.*` hard-coded hex aliases (legacy), `walnut.*` / `amber.*` / `success.*` / `warning.*` / `danger.*` / `info.*` full scales.

---

## 2. Color Reference Census

### Tailwind Utility Classes (top 20 by frequency)

| Class | Count | Migration Target |
|---|---|---|
| `text-gray-500` | 1,479 | `text-fg-muted` |
| `text-gray-900` | 1,390 | `text-fg` |
| `text-gray-600` | 1,141 | `text-fg-muted` |
| `text-gray-700` | 867 | `text-fg` |
| `text-gray-400` | 852 | `text-fg-subtle` |
| `border-gray-200` | 781 | `border-border` |
| `bg-gray-50` | 617 | `bg-canvas` |
| `border-gray-300` | 420 | `border-border-strong` |
| `bg-gray-100` | 338 | `bg-surface-muted` |
| `bg-gray-200` | 315 | `bg-surface-elev` |
| `text-red-700` | 189 | `text-data-negative-fg` |
| `text-red-600` | 176 | `text-data-negative` |
| `bg-red-50` | 172 | `bg-data-negative/10` |
| `bg-green-100` | 171 | `bg-data-positive/10` |
| `border-gray-800` | 163 | `border-border-strong` (dark) |
| `text-gray-300` | 158 | `text-fg-subtle` (dark) |
| `bg-gray-800` | 158 | `bg-surface` (dark) |
| `text-green-700` | 154 | `text-data-positive-fg` |
| `text-green-600` | 149 | `text-data-positive` |
| `bg-red-100` | 132 | `bg-data-negative/15` |

**Total Tailwind color utility occurrences:** ~9,443
**Unique patterns:** 327

### Hard-Coded Values

| Type | Count | Where |
|---|---|---|
| Hex in TSX/TS | 0 | ✓ Clean |
| `rgba()` | 419 | Mostly shadows/overlays in globals.css, products.css, ~15 component files |
| `hsl/hsla` | ~60 | Minimal |
| Inline `style={{` with color | ~80 | Scattered across ops pages (charts, conditional coloring) |

### Legacy Bridge Classes (globals.css lines 704–751)

Dark-mode overrides for raw Tailwind classes that should eventually become semantic:

```
:where(html.dark) .bg-white       → var(--surface)
:where(html.dark) .bg-gray-50     → var(--canvas)
:where(html.dark) .text-gray-900  → var(--fg)
... (18 total mappings)
```

**Migration note:** These exist because ~60% of pages still use raw Tailwind gray classes instead of semantic tokens. The Drafting Room migration should replace raw gray refs with semantic classes, then delete these bridges.

---

## 3. Typography Inventory

| Token | Current | Drafting Room Target |
|---|---|---|
| `--font-sans` | Inter (Google Fonts CDN) | Inter Variable (self-hosted via next/font/local) |
| `--font-mono` | JetBrains Mono (Google Fonts CDN) | JetBrains Mono Variable (self-hosted) |
| `--font-display` | ❌ Not in config | **Playfair Display** (italic 400/500, roman 700/800) |
| `--font-numeric` | Inter with tnum | JetBrains Mono tnum (mono for ALL numbers) |

**Font feature settings** already enabled: `cv11`, `ss01`, `ss03`. Add: `zero`, `tnum` on `:root`.

**Font sizes defined:** 15 custom sizes from `display-2xl` (3rem) down to `overline` (0.625rem). Plus `metric-xl` (2.25rem) and `metric-lg` (1.75rem) for KPIs. **Keep all size tokens; add Playfair mapping for display tiers.**

---

## 4. Elevation & Shadow Inventory

| Token | Light Value | Dark Value |
|---|---|---|
| `--elev-1` | `0 1px 2px rgba(14,13,11,0.06)` | `0 1px 2px rgba(0,0,0,0.35)` |
| `--elev-2` | `0 2px 6px rgba(14,13,11,0.08)` | `0 2px 6px rgba(0,0,0,0.45)` |
| `--elev-3` | `0 6px 16px rgba(14,13,11,0.10)` | `0 8px 18px rgba(0,0,0,0.50)` |
| `--elev-4` | `0 16px 32px rgba(14,13,11,0.12)` | `0 20px 40px rgba(0,0,0,0.55)` |

**Drafting Room upgrade:** Each elevation gets contact + ambient shadow pair. Dark shadows use deeper navy-black. Light shadows borrow a hint of walnut. Gold bloom added for hover/active on interactive elevated surfaces.

**Raw Tailwind shadow classes still in use:**
- `shadow-sm`: 192 occurrences
- `shadow-md`: 67
- `shadow-lg`: 69
- `shadow-xl`: 17
- `shadow-2xl`: 18

These should migrate to `shadow-elevation-*` tokens.

---

## 5. Border Radius Inventory

| Class | Count | Token |
|---|---|---|
| `rounded-lg` | 1,748 | `--radius-lg` (8px) |
| `rounded-xl` | 653 | `--radius-xl` (12px) |
| `rounded-full` | 621 | pill (9999px) |
| `rounded-md` | 74 | `--radius-md` (6px) |
| `rounded-2xl` | 54 | `--radius-2xl` (16px) |

**Status:** Well-standardized. No changes needed for Drafting Room — radius values are geometry, not personality.

---

## 6. Motion & Animation Inventory

### Defined Keyframes (globals.css)
- `shimmer` — skeleton loading
- `fadeIn` — opacity entrance
- `slideUp` / `slideDown` — directional entrance
- `scaleIn` — scale entrance
- `pulse-soft` — 2s opacity loop

### Easing Tokens
- `--ease-out`: `cubic-bezier(0.22, 1, 0.36, 1)`
- `--ease-in-out`: `cubic-bezier(0.65, 0, 0.35, 1)`

### Drafting Room Additions Needed
- `--ease` (house ease): `cubic-bezier(.2,.8,.2,1)` — port from Bloomfield
- `--ease-draft`: `cubic-bezier(0.6, 0.1, 0.2, 1)` — pencil-drawing feel
- `--ease-spring`: `cubic-bezier(0.34, 1.56, 0.64, 1)` — overshoot
- `--ease-press`: `cubic-bezier(0.22, 1.4, 0.36, 1)` — brass press
- Duration scale: 80/120/180/240/320/480/720/1200ms

### prefers-reduced-motion
Already implemented (globals.css lines 691–697). Kills all animation. **Upgrade:** allow state transitions ≤120ms with ease-out-quart, keep NumberFlow but shorter.

---

## 7. Component Class Inventory

| Component Class | Defined In | Usage Count | Drafting Room Action |
|---|---|---|---|
| `.panel` / `.panel-*` | globals.css | ~200+ | Restyle: paper-grain texture, gold-bloom hover, walnut-tinted shadow |
| `.btn-primary` | globals.css | ~150+ | Gold gradient + shimmer sweep (port Bloomfield `.cta-btn::before`) |
| `.btn-secondary` | globals.css | ~100+ | Navy-ink, hairline border, no fill |
| `.btn-ghost` | globals.css | ~80+ | Keep minimal, update hover to surface-muted |
| `.badge-*` | globals.css | ~165 | Pill shape, 11px mono uppercase, leading 6px dot |
| `.datatable` | globals.css | ~50+ | Virtualized, sticky mono header, inline sparklines, right-edge actions |
| `.kpi-card` | globals.css | ~40+ | Playfair Italic numerals, gold signal, drafting-grid bg |
| `.metric-*` | globals.css | ~60+ | NumberFlow digits, Playfair at display sizes, JetBrains at body |
| `.eyebrow` | globals.css | ~30+ | 11px mono uppercase, 0.22em tracking, preceded by 28px 1px gold rule |
| `.skeleton` | globals.css | ~20+ | Replace gray blobs with pencil-stroke blueprint wires |
| `.card-glass` | globals.css | ~10+ | Navy @ 70% + backdrop-blur 16px + saturate 1.4 |
| `.kbd` | globals.css | ~15+ | Monochrome, pressable, 1px inset shadow |
| `.pill` | globals.css | ~10+ | Brass-pill for toasts |

---

## 8. Bloomfield Motifs to Port

Extracted from `Abel_Bloomfield_Presentation.html` (839KB, single-file):

| Motif | Bloomfield Implementation | Aegis Port |
|---|---|---|
| **Blueprint grid** | `linear-gradient(rgba(198,162,78,.06) 1px, transparent 1px)` at 40px, radial vignette mask | Every route canvas background, parallax 0.05 on scroll |
| **Aurora blobs** | 3 radial-gradient circles, `mix-blend-mode: screen`, 20s drift animation | Dashboard ambient layer, modulated by production volume |
| **Paper grain** | SVG `feTurbulence baseFrequency=0.9, numOctaves=2`, gold-tinted `feColorMatrix`, opacity 4% | `::before` on body or elevation ≥ 2 surfaces |
| **Stroke-dashoffset drawing** | `.bp-line` with `stroke-dasharray/offset`, `drawIn` keyframe, `--ease-draft` cubic-bezier(0.6,0.1,0.2,1) | Login blueprint, empty states, skeleton loading, chart axis reveals |
| **Gold shimmer wordmark** | `background: linear-gradient(135deg, #fff 30%, #e4c77a 60%, #fff 90%)` + `-webkit-background-clip: text` + `shimmer 6s` | Hero KPI display text, wordmark in nav |
| **Section label pattern** | `.section-label::before` = 28px × 1px gold rule + mono uppercase 0.7rem, 3.5px tracking | Port verbatim to `.eyebrow` |
| **Playfair italic gold accent** | `.section-title em { font-style: italic; color: var(--gold-dark); font-weight: 500 }` | Display H1 accent word pattern |
| **Reveal stagger** | `.reveal-stagger.in > *:nth-child(n)` with 80ms increments | Page-enter animation system |
| **Nav backdrop** | `rgba(10,26,40,.85) + saturate(1.4) blur(16px)` | App shell header + dialog backdrops |
| **CTA button sweep** | `.cta-btn::before` = `linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent)` sliding left→right on hover | Primary button hover treatment |
| **Brass dot / gold fills** | `circle fill="rgba(198,162,78,.8)"` for door knob, gold radial accents | Interactive element highlights, status dots |
| **Paper-navy duality** | `--bg: #f5f2eb` (mylar) / `--bg-dark: #0a1a28` (navy) | Two fully realized themes — not washed-out mirrors |
| **Scroll progress bar** | 3px gold gradient fixed top, `box-shadow: 0 0 10px var(--gold-glow)` | Optional: route-level progress on long pages |

---

## 9. Brand DNA Constraints (from brand_dna.json)

### Must Observe
- Mood: quietly confident, earned, Texas honest, craftsman warm, magazine editorial, documentary authentic, premium without pretense
- Textures: kiln-dried wood grain, brushed brass, matte black hardware, tool-marked craftsmanship
- Lighting: golden hour 3000K, warm directional, dramatic long-shadow
- Composition: subject-forward, negative space right third, shallow depth of field

### Hard No
- AI-generated uncanny / stock-photo "construction worker smiling"
- Silicon Valley sleek / big-box corporate
- Texas clichés (cowboy hats, oil rigs, tumbleweeds)
- Corny / cheesy / over-shiny hyper-polished
- "Lumber yard first" framing — doors & trim are the hero

---

## 10. Drafting Room Color Mapping

### Primitives: Current → Target

| Current Primitive | OKLCH Target | Hex Approx | Role |
|---|---|---|---|
| `--stone-950` (#0E0D0B) | `navy-deep oklch(14% 0.03 250)` | #050d16 | Canvas ground |
| `--stone-900` (#171512) | `navy oklch(20% 0.035 245)` | #0a1a28 | Canvas |
| `--stone-800` (#24211E) | `navy-mid oklch(27% 0.04 240)` | #132d42 | Surface |
| `--stone-700` (#36322D) | `navy-light oklch(34% 0.05 235)` | #1a3d56 | Surface raised |
| `--stone-50` (#F7F5F2) | `mylar oklch(98% 0.01 85)` | #f5f2eb | Paper surface (light) |
| `--stone-100` (#EEEAE3) | `onion oklch(96% 0.015 80)` | #f9f5ec | Paper raised (light) |
| `--walnut-600` (#3E2A1E) | `walnut oklch(24% 0.045 50)` | #3E2A1E | **Unchanged** |
| `--walnut-400` (#6E543D) | `kiln-oak oklch(48% 0.06 60)` | #8B6F47 | Warm mid-tone |
| `--amber-500` (#C9822B) | `gold oklch(70% 0.13 75)` | #c6a24e | **Primary signal** |
| `--amber-400` (#D9993F) | `gold-light oklch(82% 0.1 80)` | #e4c77a | Glow, shimmer |
| `--amber-600` (#A86B1F) | `gold-dark oklch(58% 0.11 75)` | #a88a3a | Signal on light theme |
| n/a | `brass oklch(54% 0.1 75)` | #8B6F2A | Hardware accent |
| `--data-red-400` (#B64E3D) | `ember oklch(55% 0.18 32)` | #b64e3d | Danger alert |
| `--data-red-600` (#7D2B1C) | `oxblood oklch(32% 0.09 22)` | #6E2A24 | Danger deep |
| `--data-green-500` (#2F7C3A) | `moss oklch(55% 0.12 145)` | #2f7c3a | Success |
| `--data-green-400` (#43994F) | `sage oklch(70% 0.1 145)` | #5caa68 | Success bright |
| `--forecast-400` (#54607D) | `sky oklch(70% 0.07 230)` | #8CA8B8 | Info |
| n/a | `dust oklch(65% 0.07 50)` | #B8876B | Warm neutral |

### Semantic: Key Remappings

| Semantic Token | Dark (primary) | Light |
|---|---|---|
| `--bg-canvas` | navy-deep | mylar |
| `--bg-surface` | navy + grain overlay | onion |
| `--bg-raised` | navy-mid | white |
| `--bg-sunken` | navy-deep + 2px inner shadow | — |
| `--fg` | oklch(98% 0.01 80) | walnut |
| `--fg-muted` | ~65% L | walnut @ 60% |
| `--signal` | gold | gold-dark |
| `--signal-glow` | gold-light @ 25% | — |
| `--ink-pencil` | walnut-ink | walnut-ink |
| `--grid-ink` | gold @ 6% | gold @ 6% |

---

## 11. Migration Scope Estimate

| Category | Items | Effort |
|---|---|---|
| **Primitive token replacement** (globals.css) | 55 variables | 1 hour |
| **Semantic token remap** (globals.css) | ~60 variables × 2 themes | 2 hours |
| **Component class restyle** (globals.css) | 30+ classes | 3 hours |
| **Tailwind config update** | color aliases, font families, shadows, motion | 1 hour |
| **Font self-hosting** | Inter + JetBrains Mono + Playfair Display via next/font/local | 1 hour |
| **Paper grain + drafting grid** | body `::before` + canvas background | 1 hour |
| **Raw Tailwind class migration** | ~9,443 occurrences across 327 patterns → semantic classes | 8-12 hours (can be phased) |
| **Legacy bridge cleanup** | 18 `:where(html.dark)` mappings | After migration |
| **Print palette update** | @media print block | 30 min |

**Total Phase 1 (tokens + type + grain + grid + 2 mock screens):** ~8 hours
**Total full migration (all phases):** ~20-30 hours

---

## 12. Files to Modify (Phase 1)

| File | Action |
|---|---|
| `src/app/globals.css` | Replace primitives, remap semantics, restyle components, add grain/grid/motion |
| `tailwind.config.ts` | Update color aliases, add font-display, new shadow tokens, new motion tokens |
| `src/app/layout.tsx` | Add Playfair Display via next/font/local, update font variable injection |
| `next.config.js` | Ensure font optimization enabled |
| `public/fonts/` | Add self-hosted Inter, JetBrains Mono, Playfair Display woff2 files |

---

*End of audit. Phase 1 begins: tokens + two mocked screens (dashboard shell + quote drawer, both themes).*
