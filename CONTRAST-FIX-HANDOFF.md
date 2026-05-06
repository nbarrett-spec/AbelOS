# Blueprint Grid Contrast Fix — Claude Code Handoff

**Date:** 2026-04-24
**Status:** Changes made in Cowork, ready for commit + deploy
**Risk:** Visual-only — zero logic, routing, or data changes
**File modified:** `src/app/globals.css` (CSS variables only)

---

## Problem

The blueprint grid background lines lack contrast — especially in light mode where they're nearly invisible. Dark mode is close but could use a small bump. The canvas/surface/border/text tokens in light mode are all too faint, making cards blend into the background and grid lines disappear.

---

## What changed

All changes are in `src/app/globals.css`. Only CSS custom property **values** changed — no new properties, no class changes, no component modifications.

### Light mode — Blueprint primitives (`:root` block, ~line 27)

| Token | Before | After | Why |
|---|---|---|---|
| `--bp-fine` | `rgba(79,70,229,0.045)` | `rgba(79,70,229,0.09)` | 2x — thin grid lines were invisible |
| `--bp-major` | `rgba(79,70,229,0.075)` | `rgba(79,70,229,0.15)` | 2x — major grid lines barely visible |
| `--bp-annotation` | `rgba(79,70,229,0.15)` | `rgba(79,70,229,0.25)` | Callout/dimension lines needed more presence |

### Light mode — Semantic tokens (`:root` block, ~line 175)

| Token | Before | After | Why |
|---|---|---|---|
| `--canvas` | `#F0F4FA` | `#E8EDF6` | Darker canvas so white cards pop against it |
| `--surface-muted` | `#E8ECF4` | `#DEE4F0` | Matches the new canvas depth |
| `--border` | `rgba(30,58,138,0.06)` | `rgba(30,58,138,0.12)` | 2x — card borders were invisible |
| `--border-strong` | `rgba(30,58,138,0.12)` | `rgba(30,58,138,0.22)` | Emphasis borders now actually visible |
| `--fg-muted` | `#475569` | `#3D4F63` | Darker secondary text for readability |
| `--fg-subtle` | `#94A3B8` | `#6B7C8F` | Much more readable tertiary/label text |
| `--row-hover` | `rgba(79,70,229,0.03)` | `rgba(79,70,229,0.05)` | Row hover effect more visible |
| `--row-selected` | `rgba(79,70,229,0.06)` | `rgba(79,70,229,0.08)` | Selected row more visible |
| `--grid-line` | `rgba(30,58,138,0.06)` | `rgba(30,58,138,0.10)` | Table grid lines more visible |
| `--glass-shadow` | `...0.10),...0.03)` | `...0.14),...0.08)` | Glass card shadows stronger |
| `--glass-hover` | `...0.16),...0.06)` | `...0.20),...0.12)` | Glass hover shadows stronger |

### Dark mode — Blueprint primitives (`html.dark` block, ~line 264)

| Token | Before | After | Why |
|---|---|---|---|
| `--bp-fine` | `rgba(99,102,241,0.07)` | `rgba(99,102,241,0.09)` | ~25% bump for grid visibility |
| `--bp-major` | `rgba(99,102,241,0.12)` | `rgba(99,102,241,0.15)` | ~25% bump for major lines |
| `--bp-annotation` | `rgba(99,102,241,0.26)` | `rgba(99,102,241,0.30)` | Annotation lines slightly bolder |

---

## Verification

After deploying, check these:

- [ ] **Dark mode:** Blueprint grid lines visible but not overwhelming on executive dashboard
- [ ] **Light mode:** Blueprint grid lines clearly visible on canvas background
- [ ] **Light mode:** Card edges (borders) visible — cards should not blend into canvas
- [ ] **Light mode:** Muted text (`--fg-muted`) readable without squinting
- [ ] **Light mode:** Subtle/label text (`--fg-subtle`) readable on white surfaces
- [ ] **Both modes:** Table row hover effect visible when mousing over rows
- [ ] **Both modes:** Glass card shadows provide visible depth separation
- [ ] No text contrast issues introduced (check badges, status chips, chart labels)

---

## Commit message

```
visual: bump blueprint grid + light-mode contrast

Dark mode: ~25% opacity increase on grid lines.
Light mode: 2x grid line opacity, darker canvas (#E8EDF6),
stronger borders (2x), darker muted/subtle text, stronger
glass shadows. Blueprint character preserved, just more visible.
```
