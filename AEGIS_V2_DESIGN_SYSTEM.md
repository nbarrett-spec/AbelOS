# AEGIS v2 — "THE DRAFTING ROOM"

## Master Design System Document

> **This is the canonical reference for all Aegis v2 implementation.**
> Every commit, every component, every pixel decision traces back here.
> If it contradicts the code, the code is wrong.

**Last updated:** 2026-04-21
**Owner:** Nate Barrett
**Status:** APPROVED — Phase 2 ready

---

## 1. IDENTITY

Aegis is the control room of a 41-year-old Texas door manufacturer that quietly became the most advanced operating system in residential construction. It is not a SaaS dashboard. It is not a marketing site ported to an admin panel.

**The room:** An architect's drafting room at 6pm in Gainesville — long golden light across a walnut desk, navy mylar on the drawing board, brass hardware catching the glint. That is Aegis.

**Mood keywords:** Quietly confident. Earned. Texas honest. Craftsman warm. Magazine editorial. Documentary authentic. Premium without pretense.

**Anti-moods:** Silicon Valley sleek. AI-generated uncanny. Corny. Stock-photo. Big-box corporate. Purple-pink gradients. Glassmorphism. Emoji in UI chrome.

**References:** Palantir Foundry + Anduril Lattice for density. Linear + Raycast for craft. SpaceX Mission Control for alive-ness. Iwan Baan + Julius Shulman for light. Wes Anderson for composition. Active Theory for motion.

---

## 2. COLOR SYSTEM

### 2.1 Primitives (OKLCH with hex fallbacks)

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `navy-deep` | `oklch(14% 0.03 250)` | `#050d16` | Canvas ground (dark) |
| `navy` | `oklch(20% 0.035 245)` | `#0a1a28` | Canvas (dark) |
| `navy-mid` | `oklch(27% 0.04 240)` | `#132d42` | Surface (dark) |
| `navy-light` | `oklch(34% 0.05 235)` | `#1a3d56` | Surface raised (dark) |
| `mylar` | `oklch(98% 0.01 85)` | `#f5f2eb` | Paper surface (light) |
| `onion` | `oklch(96% 0.015 80)` | `#f9f5ec` | Paper raised (light) |
| `cream` | `oklch(94% 0.03 82)` | `#F3EAD8` | Warm white |
| `walnut` | `oklch(24% 0.045 50)` | `#3E2A1E` | Brand primary |
| `walnut-ink` | — | `#2A1C14` | Deep walnut for linework |
| `kiln-oak` | `oklch(48% 0.06 60)` | `#8B6F47` | Warm mid-tone |
| `brass` | `oklch(54% 0.1 75)` | `#8B6F2A` | Hardware accent |
| `gold-dark` | `oklch(58% 0.11 75)` | `#a88a3a` | Signal on light theme |
| `gold` | `oklch(70% 0.13 75)` | `#c6a24e` | **Primary signal** |
| `gold-light` | `oklch(82% 0.1 80)` | `#e4c77a` | Glow, shimmer |
| `oxblood` | `oklch(32% 0.09 22)` | `#6E2A24` | Danger deep |
| `ember` | `oklch(55% 0.18 32)` | `#b64e3d` | Danger alert |
| `moss` | `oklch(55% 0.12 145)` | `#2f7c3a` | Success |
| `sage` | `oklch(70% 0.1 145)` | `#5caa68` | Success bright |
| `sky` | `oklch(70% 0.07 230)` | `#8CA8B8` | Info |
| `dust` | `oklch(65% 0.07 50)` | `#B8876B` | Warm neutral |

### 2.2 Semantic Tokens

| Token | Dark (primary) | Light |
|---|---|---|
| `--bg-canvas` | navy-deep | mylar |
| `--bg-surface` | navy + grain overlay | onion |
| `--bg-raised` | navy-mid | white |
| `--bg-sunken` | navy-deep + 2px inner shadow | #ede8dd |
| `--fg` | #f5f1e8 | walnut |
| `--fg-muted` | #8a9aaa | #6b5d4e |
| `--fg-subtle` | #5a6a7a | #9a8e7e |
| `--fg-on-accent` | navy-deep | white |
| `--signal` | gold | gold-dark |
| `--signal-hover` | gold-light | gold |
| `--signal-subtle` | gold @ 12% | gold-dark @ 8% |
| `--signal-glow` | gold @ 25% | gold-dark @ 15% |
| `--border` | gold @ 8% | walnut @ 10% |
| `--border-strong` | gold @ 18% | walnut @ 20% |
| `--ink-pencil` | kiln-oak | walnut-ink |
| `--grid-ink` | gold @ 6% | gold @ 6% |
| `--success` | sage | moss |
| `--danger` | ember | oxblood |
| `--warn` | gold | gold-dark |
| `--info` | sky | #5a7a8a |

### 2.3 Themes

**Dark is primary** (Gainesville at dusk). Light is a full-grade "onion skin under task lighting" palette — NOT washed-out-dark. Both themes get their own grain treatment and shadow tuning.

---

## 3. TYPOGRAPHY

| Role | Font | Weights | Usage |
|---|---|---|---|
| **Display** | Playfair Display | Italic 400/500, Roman 700/800 | Title accent words only (e.g., "*Live* Operations"). NOT for numbers. |
| **UI Sans** | Inter Variable | 400–800 | All body text, labels, navigation |
| **Mono** | JetBrains Mono Variable | 400–600 | **All numbers**, IDs, timestamps, SKUs, PO/SO numbers, dimensions, KPI values, prices, table numerics, kbd, code |

### Rules

- **All numeric display uses JetBrains Mono** with `font-variant-numeric: tabular-nums`. No exceptions. Playfair is reserved exclusively for title accent words.
- Display H1 accent word uses Playfair Italic in gold (e.g., "*Live* Operations", "*Active* Quotes").
- Section labels (`.eyebrow`): 10px mono uppercase, `letter-spacing: 0.22em`, preceded by a 28px × 1px gold rule.
- Numeric columns: right-aligned, tabular-nums, mono. Always.
- Never all-caps body. Never center-aligned body.
- Feature settings on `:root`: `'cv11', 'ss01', 'ss03', 'zero', 'tnum'`.
- Self-host all fonts via `next/font/local`. No Google Fonts CDN at runtime.

---

## 4. ELEVATION & SHADOW

Four levels. Contact shadow + ambient shadow. No pastel halos.

| Level | Dark | Light | Use |
|---|---|---|---|
| `--elev-1` | Deep black, tight | Walnut-tinted, subtle | Cards at rest |
| `--elev-2` | Deeper spread | Walnut mid-spread | Hovered cards, panels |
| `--elev-3` | Heavy ambient | Medium walnut | Dropdowns, popovers |
| `--elev-4` | Maximum depth | Full walnut spread | Modals, command palette |
| `--elev-glow` | `0 0 24px gold @ 15%` | `0 0 24px gold-dark @ 10%` | Hover/active bloom on interactive surfaces |

---

## 5. TEXTURE & ATMOSPHERE

### 5.1 Paper Grain (Abel fingerprint)

Every surface at elevation ≥ 2 gets subtle SVG paper-grain texture. Applied via `::before` on `<body>` with `mix-blend-mode: overlay`.

```
feTurbulence: type="fractalNoise" baseFrequency="0.9" numOctaves="2"
feColorMatrix: gold-tinted, opacity ≤ 4%
```

### 5.2 Drafting Grid

Background canvas carries a 40px blueprint grid at 6% opacity, masked to a radial vignette (brighter center, fades to edges). Every route inherits it. Parallax at 0.05 factor on scroll.

### 5.3 Aurora Accents

Radial-gradient blobs (gold, navy) with `mix-blend-mode: screen` and slow 20s drift animation. Used on dashboard hero and section-dark backgrounds. Intensity modulated by data density when connected to live metrics.

---

## 6. MOTION

### 6.1 Easing Tokens

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(.2, .8, .2, 1)` | House ease — default for everything |
| `--ease-draft` | `cubic-bezier(0.6, 0.1, 0.2, 1)` | SVG stroke reveals, chart axis draw-in |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Sidebar expand, drawer open, modal enter |
| `--ease-press` | `cubic-bezier(0.22, 1.4, 0.36, 1)` | Button press, toggle snap |

### 6.2 Duration Scale

`80 / 120 / 180 / 240 / 320 / 480 / 720 / 1200ms`

### 6.3 Loading Strategy

**No pencil-drawing skeletons for daily-use pages.** Loading = instant content-fade (80ms opacity transition). The system should feel instant, not decorative.

**First-time empty states only:** When a section has never had data (e.g., first time opening MRP with no BoMs), show a single blueprint stroke-draw moment (the Bloomfield `drawIn` animation) as a one-time "welcome" that plays once and never repeats. Store a `has_seen_` flag in user preferences.

### 6.4 Reduced Motion

`prefers-reduced-motion`: kill all ambient motion. Keep state transitions ≤ 120ms with ease-out-quart. Keep NumberFlow but shorter duration. Disable 3D scenes, replace with static WebP fallbacks.

---

## 7. LIVE DATA LAYER

### 7.1 NumberFlow

Every KPI, currency, count, and percentage uses NumberFlow digit transitions. JetBrains Mono at all sizes. When a value changes from a server push: 180ms gold flash behind the changed digit, not the whole row.

### 7.2 Presence

Circular avatars with deterministic tint from the Abel palette (walnut/kiln-oak/brass/sky/dust — never random rainbow). 2px gold halo when the user is actively editing. Three-dot typing indicator beneath.

### 7.3 Sync Chip

Top bar: "Live · 2s" / "Catching up…" / "Offline — queued 3" with a 6px pulse dot.

### 7.4 Activity Feed

Reverse-chronological spring-in items. Mono timestamps that re-tick relative every 20s. Actor avatar + verb + object + tiny inline sparkline when the event is numeric.

### 7.5 Ambient Audio (opt-in, OFF by default)

40Hz sub-hum at -48 dB. Warm tick on number increments. Soft brass chime on PO approval. Must be opt-in per user. Tasteful or nothing.

---

## 8. 3D & VISUALIZATION MODULES

### Module A — YARD DIGITAL TWIN (Dashboard hero, /dashboard)

Real-time 3D rendering of the Gainesville yard. Not decorative — the actual live state of Abel.

- Low-poly yard ground plane with gold directional light (3000K key), cool navy rim
- Buildings: shop, office, storage — extruded footprint geometry, ink-line outline pass (EdgesGeometry + LineMaterial), pure navy with gold edge-highlighting
- Pallets: instanced mesh, position driven by live inventory bin data. Paper-label decal (mono SKU + count). Hover → gold rim. Click → inspector.
- Trucks: low-poly silhouettes. Animate along scheduled route polylines. Brass plate showing driver initials.
- Material particles: PO received → particles flow in from sky along gold bezier arc. Delivery leaves → particles flow out toward DFW waypoint. 2000-particle budget.
- Sky dome: conic-gradient noise shader modulated by today's production volume. High volume = more animated. Quiet day = still.
- Camera: orbital, 0.02 rad/s auto-drift when idle, preset POVs ("Yard", "Shop", "Loading Dock", "Office"). Scroll to zoom, drag to orbit, double-click to focus.
- Performance: single directional shadow, 2048 map, selective bloom on gold-flagged meshes only. 60fps M1 Air, 45fps 2019 Intel MBP. Fallback: pre-rendered WebP.

### Module B — DFW DELIVERY MAP (/logistics)

MapLibre GL dark basemap. Gold primary roads, mylar secondary. Pulsing gold nodes for active jobsites. Traveling particle lines along delivery routes at real ETA speed. POD signed → ripple propagates from node, flips to sage for 8s. Hover → brass pill with builder/plan/PM/PO/ETA. Click → job drawer.

### Module C — MRP DEPENDENCY GRAPH (/mrp)

Force-directed 3D graph (d3-force-3d + three). Nodes = SKUs/materials/jobs. Edges = dependencies. Sized by demand, colored by state (navy = in stock, gold = incoming, ember = short). WASD to fly. Selective bloom on ember nodes — shortages glow across the graph. `/` to filter, `n` next shortage, `.` open inspector.

### Module D — DOOR EXPLOSION VIEW (quote/order detail drawer)

3D exploded view of the actual door: slab, frame, hinges, latch, strike, trim casing, jamb. GLB models (< 200kb each, shared geometry). Timeline slider assembles from flat parts to finished unit over 4s. Dimension callouts draft themselves in with stroke-dashoffset. Hardware renders as brass PBR.

### Module E — MATERIAL FLOW SANKEY (/dashboard lower section)

Supplier → Yard → Production → Trucks → Jobs. 3D ribbon sankey, rotatable. Particles flow along bands proportional to live volume. Hover dims everything else, brightens selected flow to gold. Click → inspector breaks down by SKU family and dollar.

### Module F — LOGIN & AMBIENT ART

Login: continuous SVG blueprint animation of a different door plan per session (seeded from day of year). Draws over 9s, stops with subtle breathing fill. Email/password inputs on right third — Wes Anderson composition.

Empty states (first-time only): drafting-room moment, plays once per section per user, then instant-loads forever after.

Toast: brass-pill — navy bg, gold thin border, mono body, slight bloom on success. Stack tilts -2° like papers on a desk.

### Module G — LIVE SIGNAL LAYER (every surface)

NumberFlow, presence, pulse, sync chip, activity feed, ambient audio — as defined in Section 7.

---

## 9. MANUFACTURING & SHOP FLOOR

These features are what separate Aegis from every other construction-supply platform. Nobody in this industry shows the factory.

### 9.1 Production Line Digital Thread

Every door that enters production gets a digital thread — a persistent, real-time record from raw material receipt through final QA. The thread is a horizontal timeline component (not a vertical list) showing: Material Staged → Cut → Assembly → Hang → Hardware → QC → Staged for Delivery. Each node shows timestamp, operator, station, and duration. Click a node to see the exact operator, any quality flags, and photos if captured.

**Why it matters:** When a builder calls asking "where's my order," the PM doesn't check a spreadsheet. They open the order, see the door is at Station 4 (hardware install), operator is Julio, estimated complete in 40 minutes. That answer takes 3 seconds.

### 9.2 Station Dashboards (shop floor kiosks)

Each production station gets a dedicated view optimized for a wall-mounted tablet or monitor. Shows: current job queue, next 5 orders in priority sequence, the door spec for the current unit (species, size, handing, hardware, special instructions), and a large "Complete" button that advances the unit to the next station and timestamps the thread.

Design: maximum density, minimum chrome. Navy background, gold active-job highlight, JetBrains Mono everywhere. Touch targets ≥ 56px. No hover states — touch only. Auto-advances to next job on completion with a 3-second undo window.

### 9.3 Machine Utilization Heat Map

A time-based heat map (horizontal axis = hours of the day, vertical axis = stations/machines) showing utilization as color intensity: navy (idle), gold (active), ember (bottleneck/over-capacity). Renders for today live, scrollable back 30 days. Hover any cell to see: throughput count, avg cycle time, operator.

Reveals patterns invisible in tables: "Station 3 bottlenecks every day at 2pm because Cody's lunch overlaps with the Boise delivery window." That's the kind of insight that saves $200K/year in throughput.

### 9.4 Cycle Time Tracker

Per-station, per-product-family cycle time trending. Line chart with gold mean line, ember threshold line (target), and individual data points as dots. When a product family's cycle time drifts above target, the dot turns ember and triggers an exception in the dashboard. Over time, this builds the data to price accurately, schedule realistically, and identify training gaps.

### 9.5 Quality Gate System

At each production checkpoint, the operator can flag: Pass, Minor Defect (continue), Major Defect (hold). Flags attach to the digital thread with photo capture (phone camera → upload). A quality dashboard rolls up: defect rate by station, by product family, by operator, by week. Trend lines reveal whether quality is improving or degrading. Chronic issues surface as "Quality Alerts" in the exception panel.

---

## 10. WAREHOUSE & INVENTORY

### 10.1 Bin-Level Inventory Visualization

The yard twin (Module A) shows pallet positions, but the warehouse view goes deeper. A 2D top-down SVG map of the warehouse floor with bin locations as interactive cells. Color intensity = fill level (navy empty → gold partial → ember overstocked). Click a bin → inspector shows SKU, quantity, last count date, reorder point, velocity (units/week).

This replaces the "walk the warehouse with a clipboard" workflow. Lisa or Jordyn opens the warehouse view, sees bin B-14 is ember (overstocked on 2/8 Shaker), bin C-22 is navy (out of 6-panel hollow core), and makes decisions in 10 seconds.

### 10.2 Reorder Point Intelligence

For every SKU, Aegis tracks: average weekly consumption (rolling 12 weeks), lead time from supplier, safety stock buffer, and current on-hand. When on-hand crosses the reorder point, the SKU surfaces in the MRP shortage queue AND on the warehouse map as a pulsing node. When on-hand is projected to cross zero (stockout), it escalates to the dashboard exception panel.

The key visualization: a "days of supply" bar per SKU. Gold = healthy (> 14 days), warn = caution (7-14 days), ember = critical (< 7 days), pulsing ember = projected stockout before next delivery.

### 10.3 Receiving Dock Live Feed

When a PO is received at the dock, the receiving clerk scans or confirms the PO. Aegis shows: expected line items vs. actual received, highlighting discrepancies in ember. Short-shipped items auto-generate a vendor claim record. Damaged items get photo-flagged. The received quantities flow into the bin map in real time — the warehouse view updates as the clerk works.

### 10.4 Pick-Pack-Ship Workflow

When an order is ready for delivery, Aegis generates a pick list optimized by warehouse walk path (bin sequence, not random order). The driver or loader sees a checklist on a tablet: each line item, bin location, quantity. Tap to confirm picked. Missed items flash ember. When the pick is complete, the order status advances to "Staged" and the delivery route in Module B shows the truck as loaded.

### 10.5 Inventory Velocity Dashboard

A scatter plot: X-axis = margin contribution, Y-axis = turn rate. Every SKU is a dot, sized by revenue. Top-right quadrant = stars (high margin, high velocity). Bottom-left = dogs (low margin, slow). This is the view that tells you which products to push, which to negotiate better pricing on, and which to discontinue.

---

## 11. SUPPLY CHAIN COMMAND

### 11.1 Supplier Scorecard

Every vendor gets a live scorecard: on-time delivery rate, fill rate, quality reject rate, average lead time, price trend (12-month), and a composite grade (A-F). The scorecard updates automatically from receiving data, quality flags, and PO history. Display as a horizontal bar chart with gold for A-B, warn for C, ember for D-F.

When Nate sits down with Boise Cascade for a pricing negotiation, he opens the Boise scorecard: "Your on-time rate dropped from 94% to 87% in Q1. Here's the data." That's leverage you can't get from a spreadsheet.

### 11.2 Lead Time Heatmap

A calendar heatmap showing actual vs. promised lead times per supplier over the past 90 days. Each day is a cell, colored by deviation: gold (on time or early), warn (1-3 days late), ember (> 3 days late). Patterns jump out: "Masonite is consistently 2 days late on hollow-core but on time for solid" → adjust safety stock for hollow-core, not everything.

### 11.3 PO Lifecycle Tracker

Every purchase order has a visual lifecycle: Drafted → Sent → Acknowledged → Shipped → In Transit → Received → Reconciled. Horizontal timeline with real timestamps. If a PO stalls at "Sent" for > 48 hours, it surfaces as an exception. If a PO is partially received, the timeline splits into received and outstanding segments. Click any stage for the communication log.

### 11.4 Cost Variance Monitor

When the actual received cost on a PO line deviates from the expected cost by > 2%, Aegis flags it. A rolling cost variance chart per material family shows: expected cost trend, actual cost trend, and the gap. When lumber prices spike, you see it in real time across every affected SKU, not 30 days later in a QB report.

### 11.5 Multi-Source Material Router

For key materials (especially during supply disruptions), Aegis shows alternative suppliers per SKU with: current price, lead time, quality score, and available inventory (if shared via API or manual entry). When one supplier goes ember on lead time, the router surfaces alternatives with a one-click "switch source" that generates a PO to the alternate vendor.

### 11.6 Inbound Visibility Board

A single-screen view of every PO in transit: supplier, carrier, estimated arrival, actual location (if tracking available), and receiving dock assignment. Sorted by ETA. Color-coded by risk: gold (on track), warn (delayed 1-2 days), ember (delayed 3+ days or unknown). The dock foreman opens this every morning and knows exactly what's hitting the yard today.

---

## 12. MANAGEMENT & EXECUTIVE LAYER

### 12.1 Role-Based Density

The same data, different posture:

| Role | Default View | Density | Key Surfaces |
|---|---|---|---|
| **Owner/GM (Nate)** | Executive command center | Comfortable | P&L, AR aging, exceptions, supplier scores, margin trends |
| **COO (Clint)** | Operations overview | Default | Production throughput, delivery schedule, quality metrics, staffing |
| **Sales (Dalton/Josh)** | Pipeline + quotes | Default | Active quotes, pipeline kanban, builder health scores |
| **PM (Chad/Brittney/Thomas/Ben)** | My Day task sheet | Compact | Today's deliveries, open exceptions, builder communications |
| **Accounting (Dawn)** | Financial command center | Default | AR/AP aging, collections queue, QB sync status, invoice reconciliation |
| **Logistics (Jordyn)** | Delivery war room | Compact | DFW map, truck schedule, pick lists, route optimization |
| **Shop Floor (crew)** | Station dashboard | Maximum density | Current job, next 5, spec, complete button |

### 12.2 Executive Pulse (daily auto-generated)

Every morning at 6:30 AM, Aegis generates a one-screen "Pulse" for Nate and Clint:

- Yesterday's revenue booked vs. target (NumberFlow comparison)
- Cash position: AR collected yesterday, AP due today, net cash delta
- Production: units completed, throughput vs. plan, any quality holds
- Deliveries: completed vs. scheduled, any POD failures
- Exceptions: count by severity, oldest unresolved
- One-line AI summary: "Strong day — 14 deliveries, $42K collected, one Brookfield return pending resolution."

This replaces the morning standup for executives. Open the app, 10 seconds, you know the state of the business.

### 12.3 Margin Waterfall

A waterfall chart showing how gross margin flows from quoted price to actual realized margin: Quoted → Material Cost Variance → Labor Variance → Waste/Rework → Delivery Cost → Warranty → **Realized Margin**. Per order, per builder, or rolled up to company level. When a builder's realized margin drops below the floor, it surfaces as a signal.

### 12.4 Builder Health Score

Every active builder account gets a composite health score (A-F) based on: payment speed (DSO), order volume trend, margin trend, exception frequency, and communication responsiveness. The score updates daily. A builder sliding from B to C triggers a "Relationship Risk" alert. A builder climbing from C to A triggers a "Growth Opportunity" signal in the sales queue.

### 12.5 Workforce Heatmap

A per-person, per-day heatmap of output: units produced (shop floor), deliveries completed (drivers), orders managed (PMs), quotes closed (sales). Not surveillance — pattern recognition. "Cody's output drops every Friday afternoon" is a scheduling insight. "Brittney closes 3x the quotes of anyone else on Pulte accounts" is a talent insight.

### 12.6 Cash Flow Forecast

A 13-week rolling cash flow projection: starting cash + expected AR collections (based on DSO per builder) - expected AP payments (based on PO due dates) - payroll - fixed overhead = projected weekly ending cash. Visualized as an area chart with gold for positive, ember dipping below the credit line threshold. This is the view Hancock Whitney wants to see — and the view that prevents Nate from ever being surprised by a cash crunch.

### 12.7 Decision Log

Every significant decision in Aegis gets logged with: who, when, what, why, and outcome (filled in later). Pricing overrides, credit holds, vendor switches, staffing changes, exception resolutions. Searchable, filterable, and linked to the affected records. Over time, this builds an institutional memory that survives employee turnover.

### 12.8 Delegation & Approval Chains

Configurable approval workflows: POs above $X require Clint's approval. Credit holds require Nate. Price overrides require Dalton + Nate. Each approval request shows up as a card in the approver's queue with full context (the record, the reason, the requester, the dollar impact) and two buttons: Approve / Reject + reason. No email chains. No Slack threads. The approval lives on the record.

---

## 13. SURFACE-BY-SURFACE DIRECTION

### 13.1 Dashboard (/dashboard)

Top 60vh: YARD TWIN (Module A). Sticky KPI strip: Open POs, AR>60, DSO, Today's Deliveries, WIP — all NumberFlow, JetBrains Mono. Material Sankey (Module E) below. Right inspector: today's exceptions sorted by severity.

### 13.2 MRP (/mrp)

Full-bleed 3D BoM graph (Module C). Left rail: shortage queue with days-of-supply bars. Right inspector: selected node. Command bar at bottom with kbd reference.

### 13.3 Logistics (/logistics)

DFW MAP (Module B) top half. Gantt delivery schedule bottom half — swimlanes per truck/driver. Drag to reassign, conflicts flash ember. Map and Gantt stay in sync.

### 13.4 Production (/production)

Shop-floor schedule with station swimlanes. Each WIP card shows blueprint thumbnail of the door. Digital thread timeline per order. Machine utilization heatmap. Cycle time trends.

### 13.5 Warehouse (/warehouse)

Top: 2D bin-level SVG map with fill-level color coding. Bottom: reorder point dashboard with days-of-supply bars. Receiving dock live feed sidebar. Inventory velocity scatter plot.

### 13.6 Sales (/sales)

Pipeline kanban with spring physics on drag. Quote drawer with door explosion (Module D). Line items, BoM, pricing, margin bar.

### 13.7 Collections (/finance/collections)

AR aging waterfall. Click a bucket to shatter into invoice cards. Per-builder drill: payment sparkline, communication log, "Draft collections email" action.

### 13.8 Supply Chain (/supply-chain)

Supplier scorecards (A-F). Lead time heatmap. PO lifecycle tracker. Cost variance monitor. Inbound visibility board. Multi-source router.

### 13.9 Executive (/executive)

Morning Pulse. Margin waterfall. Cash flow forecast (13-week). Builder health scores (A-F grid). Workforce heatmap. Decision log.

### 13.10 Command Palette (⌘K)

Scoped: default / `/` create / `>` power / `@` people / `#` IDs / `?` help. Mini force-graph preview for entity IDs. Spring scale entrance, 180ms.

### 13.11 Record Drawer (global, right-side)

Tabs: Details, Timeline, Files, Linked, Audit, Raw. Raw = JSON with git-style diff vs. last version. Timeline = vertical rail of dated pencil marks with brass grommet avatars.

---

## 14. COMPONENT PRIMITIVES

Built in `src/components/ui/` with Storybook entries. Each must feel brass-pressed, not Figma-default.

| Component | Key Treatment |
|---|---|
| **Button (primary)** | Gold gradient + gold bloom shadow. Hover: translateY(-1px) + light-band sweep (Bloomfield `.cta-btn::before`). |
| **Button (ghost)** | Navy-ink, hairline border, no fill. |
| **Input** | Hairline border, gold focus ring 1.5px + 8px bloom. Floating label. Trailing slot for unit/kbd. |
| **Select/Combobox** | cmdk-based. Sticky group headers in mono small-caps. |
| **Table** | Virtualized. Sticky mono header. No zebra — border rows. Inline sparklines. Right-edge row actions on hover. Numeric right-aligned tabular mono. |
| **Sheet/Dialog** | Spring enter, slight scale. Backdrop: navy @ 70% + blur(16px) + saturate(1.4). |
| **Command** | ⌘K palette per §13.10. |
| **Toast** | Brass pill: navy bg, gold border, mono body, bloom on success. Stack tilts -2°. |
| **Badge** | Pill, 10px mono uppercase, leading 6px dot. |
| **Kbd** | Mono, pressable, 1px inset shadow. |
| **StatusDot** | 6px, animates only when "live". |
| **NumberFlow** | Digit transitions, JetBrains Mono at all sizes. 180ms gold flash on change. |
| **Skeleton** | Instant content-fade (80ms opacity). No decorative loading animation for daily pages. |
| **Avatar** | Deterministic tint from Abel palette hash. Gold halo when live. |
| **Sparkline** | Inline SVG, 48×16px, gold stroke on dark, walnut stroke on light. |
| **DaysOfSupply** | Horizontal bar with gold/warn/ember segments + numeric label. |
| **Timeline** | Horizontal node chain for production thread / PO lifecycle. |
| **HeatmapCell** | Colored rectangle with navy→gold→ember gradient. Hover → tooltip. |

---

## 15. DENSITY MODES

One toggle: Comfortable / Default / Compact. Entire app reflows.

| Property | Comfortable | Default | Compact |
|---|---|---|---|
| Row height | 48px | 40px | 32px |
| Card padding | 20px | 16px | 12px |
| Font body | 14px | 13px | 12px |
| Font caption | 12px | 11px | 10px |
| Gap (grid) | 16px | 12px | 8px |
| KPI value | 32px | 28px | 24px |

---

## 16. ACCESSIBILITY & PERFORMANCE

- WCAG 2.2 AA minimum on text and UI. Contrast checked per theme.
- `prefers-reduced-motion`: disable 3D, replace with WebP. Cap transitions at 120ms.
- Every 3D module has a "Show as table" / "Show as list" fallback — one click.
- Every chart keyboard-navigable (arrows, Enter, Esc).
- Focus ring: `:focus-visible` only — suppressed on mouse.
- Lighthouse perf ≥ 88 on /dashboard with yard twin; ≥ 95 on text surfaces.
- 3D budget: < 180kb gz scene code per route, < 2.5MB GLB per flagship module, 60fps M1 Air.
- No localStorage. No client-side secrets. Self-host all fonts.
- Touch targets ≥ 44px on `pointer: coarse`. Station dashboards ≥ 56px.

---

## 17. EXECUTION ORDER

Feature flag: `AEGIS_V2_DRAFTING_ROOM`. All work behind it until Phase 6 flip.

| Phase | Scope | Deliverable |
|---|---|---|
| **0** | Audit | ✅ DESIGN_AUDIT.md (complete) |
| **1** | Tokens + type + grain + grid + two mocks | ✅ phase1-drafting-room-mock.html (approved) |
| **2** | Primitives — Button, Input, Table, Dialog, Sheet, Command, Toast, Tabs, Badge, Avatar, StatusDot, NumberFlow, Kbd, Sparkline, DaysOfSupply, Timeline, HeatmapCell | One commit per primitive, each with Storybook |
| **3** | App shell + login + loading/error system + density toggle |  |
| **4a** | Module F — login blueprint + empty states + toast system |  |
| **4b** | Module A — Yard digital twin on /dashboard |  |
| **4c** | Module D — Door explosion in quote drawer |  |
| **4d** | Module C — MRP 3D graph |  |
| **4e** | Module B — DFW delivery map |  |
| **4f** | Module E — 3D material flow sankey |  |
| **5** | Live signal layer — presence, pulse, sync chip, activity, audio |  |
| **6** | Flip flag. Remove old tokens. Delete dead classes. |  |
| **7** | Manufacturing: digital thread, station dashboards, utilization heatmap, cycle time, quality gates |  |
| **8** | Warehouse: bin map, reorder intelligence, receiving dock, pick-pack-ship, velocity dashboard |  |
| **9** | Supply chain: supplier scorecards, lead time heatmap, PO lifecycle, cost variance, multi-source router, inbound board |  |
| **10** | Executive: pulse, margin waterfall, cash forecast, builder health, workforce heatmap, decision log, approval chains |  |
| **11** | SYSTEM.md + Storybook published. Design system documentation. |  |

---

## 18. ANTI-PATTERNS (hard no)

- Purple-pink gradients anywhere
- Glassmorphism on data-heavy surfaces
- Default shadcn `background`/`foreground` token names — rename all
- Default Recharts palette — all charts draw from semantic tokens
- Stock-photo rendering, AI-face heroes, "construction worker smiling at camera"
- Cowboy-hat / oil-rig / tumbleweed Texas clichés
- Rounded-3xl card stacks in a 3-col marketing grid as a "dashboard"
- Zebra rows. Center-aligned body. All-caps body.
- `ease-linear` or `1000ms` transitions
- Emoji in UI chrome. Cutesy illustrations. Mascots.
- More than two font families in one viewport
- Decorative loading animations on daily-use pages — loading must be instant or invisible
- Any animation on idle decorative elements (exception: yard twin ambient and drafting grid, which represent live data state)

---

## 19. CREATIVE FREEDOM

**Latitude on:** exact easing curves within ranges above, GLB geometries for yard twin (build, don't buy stock), login blueprint composition per day, sound design (if opt-in and tasteful), grace-note details that fit the Drafting Room spirit (brass pushpin rotation on pin, paper-flip tab transition, gold dust particles on approval).

**No latitude on:** palette direction (navy/gold/cream/walnut), typography rules (all numbers in mono), data accuracy (real Prisma schema, no dummy data), accessibility minimums, performance budgets, brand no-go list.

---

*End of document. This is the plan. Start cutting code.*
