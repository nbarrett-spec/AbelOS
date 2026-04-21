/**
 * Aegis v2 Blueprint library.
 *
 * Twelve architect-style door plan SVGs — each a plan-view line drawing on
 * a 400×600 viewbox, stroked in `currentColor` so the login canvas and
 * empty states can re-tint them gold. Each path exposes a `length` so the
 * animation component can pre-compute stroke-dashoffset for a draw-in.
 *
 * These are hand-tuned with generous stroke lengths so the 9-second
 * draw-in feels architectural rather than jittery. All coordinates are
 * in the 0–400 × 0–600 space.
 */

export interface BlueprintPath {
  /** SVG path `d` attribute */
  d: string
  /** Approximate path length — used for stroke-dasharray/stroke-dashoffset. */
  length: number
  /** Stroke width in SVG user units. */
  width?: number
}

export interface Blueprint {
  /** Stable key — used as seed bucket */
  id: string
  /** Human label, shown on hover in empty states */
  name: string
  /** Short poetic description for empty states / debug */
  description: string
  /** ViewBox dimensions — every blueprint is 400 × 600 */
  viewBox: string
  /** Ordered paths — animation draws them in order for a nice reveal cadence. */
  paths: BlueprintPath[]
}

// ── helpers ────────────────────────────────────────────────────────────────
// Path lengths are coarse estimates (we favor a slightly over-long dasharray
// over one that cuts short — the latter visibly "snaps" at the end).
const L = (n: number) => Math.round(n)

// ── 1. Craftsman Single ─────────────────────────────────────────────────────
const CRAFTSMAN_SINGLE: Blueprint = {
  id: 'craftsman-single',
  name: 'Craftsman Single',
  description: 'Classic 3-over-3 Craftsman, straight-top, tapered stiles.',
  viewBox: '0 0 400 600',
  paths: [
    // Door slab outline
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    // Inner stile frame
    { d: 'M120 80 L280 80 L280 520 L120 520 Z', length: L(1200) },
    // Top 3-lite panel
    { d: 'M140 100 L260 100 L260 200 L140 200 Z', length: L(440) },
    { d: 'M180 100 L180 200', length: L(100) },
    { d: 'M220 100 L220 200', length: L(100) },
    // Middle rail
    { d: 'M120 220 L280 220', length: L(160) },
    // Center panel
    { d: 'M140 240 L260 240 L260 440 L140 440 Z', length: L(640) },
    // Bottom rail
    { d: 'M120 460 L280 460', length: L(160) },
    // Bottom panel
    { d: 'M140 480 L260 480 L260 500 L140 500 Z', length: L(280) },
    // Hardware (handle)
    { d: 'M270 300 L275 300 L275 320 L270 320 Z', length: L(50) },
  ],
}

// ── 2. Craftsman Double ─────────────────────────────────────────────────────
const CRAFTSMAN_DOUBLE: Blueprint = {
  id: 'craftsman-double',
  name: 'Craftsman Double',
  description: 'Mirrored Craftsman pair with astragal — entry statement.',
  viewBox: '0 0 400 600',
  paths: [
    // Jamb + header
    { d: 'M40 40 L360 40 L360 560 L40 560 Z', length: L(1680) },
    // Astragal center
    { d: 'M200 60 L200 540', length: L(480) },
    // Left slab
    { d: 'M60 60 L195 60 L195 540 L60 540 Z', length: L(1230) },
    // Right slab
    { d: 'M205 60 L340 60 L340 540 L205 540 Z', length: L(1230) },
    // Upper lite left
    { d: 'M80 80 L180 80 L180 180 L80 180 Z', length: L(400) },
    { d: 'M80 130 L180 130', length: L(100) },
    // Upper lite right
    { d: 'M220 80 L320 80 L320 180 L220 180 Z', length: L(400) },
    { d: 'M220 130 L320 130', length: L(100) },
    // Lower panel left
    { d: 'M80 210 L180 210 L180 520 L80 520 Z', length: L(820) },
    // Lower panel right
    { d: 'M220 210 L320 210 L320 520 L220 520 Z', length: L(820) },
    // Handles
    { d: 'M165 310 L175 310 L175 330 L165 330 Z', length: L(60) },
    { d: 'M225 310 L235 310 L235 330 L225 330 Z', length: L(60) },
  ],
}

// ── 3. Shaker 5-Panel ────────────────────────────────────────────────────────
const SHAKER: Blueprint = {
  id: 'shaker-five-panel',
  name: 'Shaker 5-Panel',
  description: 'Flat-profile Shaker, five equal rails — quiet competence.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 50 L300 50 L300 550 L100 550 Z', length: L(1400) },
    { d: 'M120 70 L280 70 L280 530 L120 530 Z', length: L(1240) },
    // Five equal panels, each 90 tall with 10px gaps
    { d: 'M140 90 L260 90 L260 180 L140 180 Z', length: L(420) },
    { d: 'M140 200 L260 200 L260 290 L140 290 Z', length: L(420) },
    { d: 'M140 310 L260 310 L260 400 L140 400 Z', length: L(420) },
    { d: 'M140 420 L260 420 L260 510 L140 510 Z', length: L(420) },
    // Hardware
    { d: 'M270 300 L275 300 L275 320 L270 320 Z', length: L(50) },
  ],
}

// ── 4. Arched Top ───────────────────────────────────────────────────────────
const ARCHED_TOP: Blueprint = {
  id: 'arched-top',
  name: 'Arched Top',
  description: 'Eyebrow arch with radiating mullions — ecclesiastical.',
  viewBox: '0 0 400 600',
  paths: [
    // Curved header + slab
    { d: 'M100 200 A100 100 0 0 1 300 200 L300 540 L100 540 Z', length: L(1380) },
    { d: 'M120 210 A80 80 0 0 1 280 210 L280 520 L120 520 Z', length: L(1110) },
    // Radiating mullions from arch center (200, 210)
    { d: 'M200 210 L140 170', length: L(72) },
    { d: 'M200 210 L160 140', length: L(80) },
    { d: 'M200 210 L200 120', length: L(90) },
    { d: 'M200 210 L240 140', length: L(80) },
    { d: 'M200 210 L260 170', length: L(72) },
    // Center rail
    { d: 'M120 330 L280 330', length: L(160) },
    // Bottom panel
    { d: 'M140 350 L260 350 L260 500 L140 500 Z', length: L(540) },
    // Handle
    { d: 'M268 400 L275 400 L275 425 L268 425 Z', length: L(60) },
  ],
}

// ── 5. Six-Panel Colonial ──────────────────────────────────────────────────
const SIX_PANEL: Blueprint = {
  id: 'six-panel-colonial',
  name: 'Six-Panel Colonial',
  description: 'Traditional 6-panel, raised moldings, center stile.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    { d: 'M120 80 L280 80 L280 520 L120 520 Z', length: L(1200) },
    // Top two panels
    { d: 'M140 100 L195 100 L195 240 L140 240 Z', length: L(390) },
    { d: 'M205 100 L260 100 L260 240 L205 240 Z', length: L(390) },
    // Middle two panels
    { d: 'M140 260 L195 260 L195 380 L140 380 Z', length: L(350) },
    { d: 'M205 260 L260 260 L260 380 L205 380 Z', length: L(350) },
    // Bottom two panels
    { d: 'M140 400 L195 400 L195 500 L140 500 Z', length: L(310) },
    { d: 'M205 400 L260 400 L260 500 L205 500 Z', length: L(310) },
    // Center stile
    { d: 'M200 100 L200 500', length: L(400) },
    // Handle
    { d: 'M268 300 L275 300 L275 320 L268 320 Z', length: L(50) },
  ],
}

// ── 6. Glass Pane (full-lite) ───────────────────────────────────────────────
const GLASS_PANE: Blueprint = {
  id: 'full-glass',
  name: 'Full-Lite Glass',
  description: 'Minimalist full-glass with slim Brass-tone frame.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    { d: 'M115 75 L285 75 L285 525 L115 525 Z', length: L(1240) },
    // Interior bevel
    { d: 'M125 85 L275 85 L275 515 L125 515 Z', length: L(1160) },
    // Suggestion of beveled edges (diagonal corner reflections)
    { d: 'M125 85 L160 120', length: L(50) },
    { d: 'M275 85 L240 120', length: L(50) },
    { d: 'M125 515 L160 480', length: L(50) },
    { d: 'M275 515 L240 480', length: L(50) },
    // Handle
    { d: 'M270 300 L280 300 L280 320 L270 320 Z', length: L(60) },
  ],
}

// ── 7. French Double ────────────────────────────────────────────────────────
const FRENCH_DOUBLE: Blueprint = {
  id: 'french-double',
  name: 'French Double',
  description: 'Paired glass with 15-lite grille — belongs on a garden.',
  viewBox: '0 0 400 600',
  paths: [
    // Frame
    { d: 'M40 60 L360 60 L360 540 L40 540 Z', length: L(1600) },
    // Center astragal
    { d: 'M200 60 L200 540', length: L(480) },
    // Left door outline
    { d: 'M60 80 L195 80 L195 520 L60 520 Z', length: L(1150) },
    // Right door outline
    { d: 'M205 80 L340 80 L340 520 L205 520 Z', length: L(1150) },
    // Left grille (3 x 5 = 15 lites)
    { d: 'M105 100 L105 500', length: L(400) },
    { d: 'M150 100 L150 500', length: L(400) },
    { d: 'M75 180 L185 180', length: L(110) },
    { d: 'M75 260 L185 260', length: L(110) },
    { d: 'M75 340 L185 340', length: L(110) },
    { d: 'M75 420 L185 420', length: L(110) },
    // Right grille
    { d: 'M250 100 L250 500', length: L(400) },
    { d: 'M295 100 L295 500', length: L(400) },
    { d: 'M215 180 L325 180', length: L(110) },
    { d: 'M215 260 L325 260', length: L(110) },
    { d: 'M215 340 L325 340', length: L(110) },
    { d: 'M215 420 L325 420', length: L(110) },
    // Handles
    { d: 'M170 310 L180 310 L180 330 L170 330 Z', length: L(60) },
    { d: 'M220 310 L230 310 L230 330 L220 330 Z', length: L(60) },
  ],
}

// ── 8. Farmhouse X-brace ───────────────────────────────────────────────────
const FARMHOUSE_X: Blueprint = {
  id: 'farmhouse-x',
  name: 'Farmhouse X-brace',
  description: 'Z-braced plank — knot-speckled, iron strap hardware.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    // Vertical planks
    { d: 'M140 60 L140 540', length: L(480) },
    { d: 'M180 60 L180 540', length: L(480) },
    { d: 'M220 60 L220 540', length: L(480) },
    { d: 'M260 60 L260 540', length: L(480) },
    // Top horizontal brace
    { d: 'M100 120 L300 120', length: L(200) },
    // Bottom horizontal brace
    { d: 'M100 480 L300 480', length: L(200) },
    // X-brace diagonals
    { d: 'M100 120 L300 480', length: L(420) },
    { d: 'M300 120 L100 480', length: L(420) },
    // Iron strap hinges (left side)
    { d: 'M100 150 L140 150 L140 160 L100 160 Z', length: L(100) },
    { d: 'M100 440 L140 440 L140 450 L100 450 Z', length: L(100) },
    // Ring pull
    { d: 'M280 300 A10 10 0 1 1 280 320', length: L(65) },
  ],
}

// ── 9. Modern Flush ─────────────────────────────────────────────────────────
const MODERN_FLUSH: Blueprint = {
  id: 'modern-flush',
  name: 'Modern Flush',
  description: 'Monolithic slab, horizontal bar pull — the quiet option.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 40 L300 40 L300 560 L100 560 Z', length: L(1440) },
    { d: 'M110 50 L290 50 L290 550 L110 550 Z', length: L(1360) },
    // Full-height vertical reveal — the "pull"
    { d: 'M250 80 L258 80 L258 520 L250 520 Z', length: L(896) },
    // Horizontal kick plate reveal at bottom
    { d: 'M110 500 L290 500', length: L(180) },
    // Top + bottom shadow reveals
    { d: 'M110 100 L290 100', length: L(180) },
  ],
}

// ── 10. Dutch Door ──────────────────────────────────────────────────────────
const DUTCH: Blueprint = {
  id: 'dutch',
  name: 'Dutch Door',
  description: 'Split top/bottom — midline rail, top lite, plank bottom.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    { d: 'M120 80 L280 80 L280 520 L120 520 Z', length: L(1200) },
    // The split — double rail
    { d: 'M120 295 L280 295', length: L(160) },
    { d: 'M120 305 L280 305', length: L(160) },
    // Top half: full glass lite
    { d: 'M140 100 L260 100 L260 280 L140 280 Z', length: L(600) },
    { d: 'M200 100 L200 280', length: L(180) },
    { d: 'M140 190 L260 190', length: L(120) },
    // Bottom half: plank
    { d: 'M160 320 L160 500', length: L(180) },
    { d: 'M200 320 L200 500', length: L(180) },
    { d: 'M240 320 L240 500', length: L(180) },
    { d: 'M140 500 L260 500', length: L(120) },
    // Shelf rail
    { d: 'M90 290 L310 290', length: L(220) },
    // Two handles
    { d: 'M270 180 L275 180 L275 200 L270 200 Z', length: L(50) },
    { d: 'M270 400 L275 400 L275 420 L270 420 Z', length: L(50) },
  ],
}

// ── 11. Raised Panel (4-panel) ──────────────────────────────────────────────
const RAISED_PANEL: Blueprint = {
  id: 'raised-panel',
  name: 'Raised Panel',
  description: 'Four raised panels with beveled field — formal entry.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    { d: 'M120 80 L280 80 L280 520 L120 520 Z', length: L(1200) },
    // Top two panels (outer)
    { d: 'M140 100 L195 100 L195 290 L140 290 Z', length: L(500) },
    { d: 'M205 100 L260 100 L260 290 L205 290 Z', length: L(500) },
    // Top two panels (inner bevel)
    { d: 'M150 110 L185 110 L185 280 L150 280 Z', length: L(410) },
    { d: 'M215 110 L250 110 L250 280 L215 280 Z', length: L(410) },
    // Bottom two panels (outer)
    { d: 'M140 310 L195 310 L195 500 L140 500 Z', length: L(500) },
    { d: 'M205 310 L260 310 L260 500 L205 500 Z', length: L(500) },
    // Bottom two panels (inner bevel)
    { d: 'M150 320 L185 320 L185 490 L150 490 Z', length: L(410) },
    { d: 'M215 320 L250 320 L250 490 L215 490 Z', length: L(410) },
    // Center stile
    { d: 'M200 100 L200 500', length: L(400) },
    // Handle + escutcheon
    { d: 'M265 300 L275 300 L275 320 L265 320 Z', length: L(60) },
    { d: 'M260 295 L280 295 L280 325 L260 325 Z', length: L(100) },
  ],
}

// ── 12. Mission Style ───────────────────────────────────────────────────────
const MISSION: Blueprint = {
  id: 'mission',
  name: 'Mission Style',
  description: 'Vertical stickley panels — quarter-sawn oak spirit.',
  viewBox: '0 0 400 600',
  paths: [
    { d: 'M100 60 L300 60 L300 540 L100 540 Z', length: L(1360) },
    { d: 'M120 80 L280 80 L280 520 L120 520 Z', length: L(1200) },
    // Three tall vertical panels
    { d: 'M140 100 L175 100 L175 460 L140 460 Z', length: L(790) },
    { d: 'M185 100 L215 100 L215 460 L185 460 Z', length: L(780) },
    { d: 'M225 100 L260 100 L260 460 L225 460 Z', length: L(790) },
    // Horizontal upper lites (above panels)
    { d: 'M140 100 L260 100', length: L(120) },
    // Lower kick panel
    { d: 'M140 480 L260 480 L260 500 L140 500 Z', length: L(280) },
    // Handle
    { d: 'M268 290 L275 290 L275 310 L268 310 Z', length: L(50) },
    // Mullion breaks
    { d: 'M157 100 L157 460', length: L(360) },
    { d: 'M243 100 L243 460', length: L(360) },
  ],
}

export const BLUEPRINTS: readonly Blueprint[] = [
  CRAFTSMAN_SINGLE,
  CRAFTSMAN_DOUBLE,
  SHAKER,
  ARCHED_TOP,
  SIX_PANEL,
  GLASS_PANE,
  FRENCH_DOUBLE,
  FARMHOUSE_X,
  MODERN_FLUSH,
  DUTCH,
  RAISED_PANEL,
  MISSION,
] as const

export function blueprintForSeed(seed: number): Blueprint {
  const idx = ((seed % BLUEPRINTS.length) + BLUEPRINTS.length) % BLUEPRINTS.length
  return BLUEPRINTS[idx]
}

export function blueprintById(id: string): Blueprint | null {
  return BLUEPRINTS.find((b) => b.id === id) ?? null
}
