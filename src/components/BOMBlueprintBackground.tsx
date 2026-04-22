'use client'

/**
 * BOMBlueprintBackground — animated SVG exploded Bill-of-Materials tree for a
 * 6-panel entry door assembly, rendered in the same architectural blueprint
 * aesthetic as PortalBackground.tsx.
 *
 * Tree shape (mirrors BomEntry parent→component relation in schema.prisma):
 *   Root (Product): 6-PANEL ENTRY DOOR ASSY — SKU ED-4420
 *     ├── DOOR SLAB (×1)
 *     │     ├── TOP RAIL
 *     │     ├── LOCK RAIL
 *     │     ├── BOTTOM RAIL
 *     │     ├── STILES × 2
 *     │     └── PANELS × 6
 *     ├── JAMB SET (×1)
 *     ├── HINGE — 4" SN (×3)
 *     ├── LOCKSET — EMTEK (×1)
 *     ├── WEATHERSTRIP KIT (alt — dashed)
 *     └── THRESHOLD — ALUM (×1)
 */

import { memo } from 'react'

export interface BOMBlueprintBackgroundProps {
  className?: string
  opacity?: number
}

/* ── Shared style helpers (mirrors PortalBackground.tsx) ─────────────── */

// Draw-in animation for strokes
const d = (length: number, delay: number = 0, width: number = 1) => ({
  strokeDasharray: length,
  strokeDashoffset: length,
  animation: `bp-draw 5s cubic-bezier(0.6, 0.1, 0.2, 1) ${delay}s forwards`,
  strokeWidth: width,
  stroke: 'currentColor',
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

// Dashed variant — alt / optional paths, dimension lines
const dd = (length: number, delay: number = 0, width: number = 0.8) => ({
  ...d(length, delay, width),
  strokeDasharray: '6,4',
})

// Dimension text style (measurement labels)
const dimText = (delay: number = 0) => ({
  fill: 'currentColor',
  fontFamily: "'Azeret Mono', monospace",
  fontSize: '9px',
  letterSpacing: '0.08em',
  opacity: 0,
  animation: `bp-fade 1.5s ease ${delay}s forwards`,
})

// Annotation text (small, uppercase, tracked)
const annoText = (delay: number = 0) => ({
  ...dimText(delay),
  fontSize: '7px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.15em',
})

// Pulse dot
const pulseDot = (cx: number, cy: number, color: string, delay: number) => (
  <circle
    key={`p-${cx}-${cy}`}
    cx={cx}
    cy={cy}
    r="3"
    style={{
      fill: color,
      opacity: 0.5,
      animation: `bp-pulse 3s ease-in-out ${delay}s infinite`,
    }}
  />
)

/* ── SVG: exploded BOM tree ──────────────────────────────────────────── */

function BomBlueprintSVG() {
  return (
    <svg viewBox="0 0 1200 800" className="w-full h-full portal-bg-element">
      {/* Title block — top right */}
      <rect x="940" y="20" width="240" height="80" rx="0" style={d(640, 0, 0.8)} />
      <line x1="940" y1="50" x2="1180" y2="50" style={d(240, 0.3, 0.6)} />
      <line x1="940" y1="70" x2="1180" y2="70" style={d(240, 0.4, 0.6)} />
      <text x="955" y="42" style={annoText(1.5)}>ABEL LUMBER — BILL OF MATERIALS</text>
      <text x="955" y="63" style={dimText(1.8)}>6-PANEL ENTRY — ED-4420</text>
      <text x="955" y="83" style={dimText(2.0)}>REV 02 — APR 2026 — SH 1/1</text>

      {/* Border frame */}
      <rect x="15" y="15" width="1170" height="770" rx="0" style={d(3880, 0, 0.4)} />

      {/* Corner registration marks — all four corners */}
      <line x1="5" y1="15" x2="15" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="15" y1="5" x2="15" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="1185" y1="5" x2="1185" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="1185" y1="15" x2="1195" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="5" y1="785" x2="15" y2="785" style={d(10, 0.1, 0.6)} />
      <line x1="15" y1="785" x2="15" y2="795" style={d(10, 0.1, 0.6)} />
      <line x1="1185" y1="785" x2="1195" y2="785" style={d(10, 0.1, 0.6)} />
      <line x1="1185" y1="785" x2="1185" y2="795" style={d(10, 0.1, 0.6)} />

      {/* ── ROOT ASSEMBLY (Level 0) ─────────────────────────────────── */}
      <rect x="500" y="90" width="200" height="60" rx="4" style={d(520, 0.3, 2)} />
      <line x1="500" y1="118" x2="700" y2="118" style={d(200, 0.6, 0.6)} />
      <text x="510" y="110" style={dimText(1.5)}>6-PANEL ENTRY DOOR ASSY</text>
      <text x="510" y="136" style={annoText(1.8)}>SKU ED-4420 — QTY 1</text>

      {/* Cross-hatch inside root assembly box */}
      <clipPath id="bom-root-clip">
        <rect x="502" y="92" width="196" height="56" />
      </clipPath>
      <g clipPath="url(#bom-root-clip)" style={{ opacity: 0.1 }}>
        {Array.from({ length: 18 }, (_, i) => (
          <line
            key={`rh-${i}`}
            x1={500 + i * 14}
            y1="90"
            x2={500 + i * 14 - 20}
            y2="150"
            style={d(60, 0.7 + i * 0.03, 0.4)}
          />
        ))}
      </g>

      {/* ── Connectors: root → horizontal busbar → six L1 children ──── */}
      <line x1="600" y1="150" x2="600" y2="200" style={d(50, 1.2, 1)} />
      <line x1="150" y1="200" x2="1050" y2="200" style={d(900, 1.4, 1)} />
      {[150, 330, 510, 690, 870, 1050].map((x, i) => (
        <line
          key={`stub-${i}`}
          x1={x}
          y1="200"
          x2={x}
          y2="240"
          style={d(40, 1.6 + i * 0.1, 1)}
        />
      ))}

      {/* Quantity circles at each junction (small badges on the busbar) */}
      {[
        { x: 150, qty: '×1', delay: 2.0 },
        { x: 330, qty: '×1', delay: 2.1 },
        { x: 510, qty: '×3', delay: 2.2 },
        { x: 690, qty: '×1', delay: 2.3 },
        { x: 870, qty: '×1', delay: 2.4 },
        { x: 1050, qty: '×1', delay: 2.5 },
      ].map(({ x, qty, delay }, i) => (
        <g key={`qty-${i}`}>
          <circle cx={x} cy="220" r="10" style={d(63, delay, 0.8)} />
          <text
            x={x}
            y="223"
            textAnchor="middle"
            style={{ ...annoText(delay + 0.3), fontSize: '7px' }}
          >
            {qty}
          </text>
        </g>
      ))}

      {/* ── Level 1 nodes (six children of root) ────────────────────── */}
      {/* 1 — DOOR SLAB */}
      <rect x="70" y="240" width="160" height="54" rx="3" style={d(428, 1.8, 1.5)} />
      <line x1="70" y1="265" x2="230" y2="265" style={d(160, 2.0, 0.5)} />
      <text x="80" y="258" style={dimText(2.3)}>DOOR SLAB</text>
      <text x="80" y="282" style={annoText(2.5)}>ED-SLB-4420 • QTY 1</text>

      {/* 2 — JAMB SET */}
      <rect x="250" y="240" width="160" height="54" rx="3" style={d(428, 1.9, 1.5)} />
      <line x1="250" y1="265" x2="410" y2="265" style={d(160, 2.1, 0.5)} />
      <text x="260" y="258" style={dimText(2.4)}>JAMB SET — 4-9/16&quot;</text>
      <text x="260" y="282" style={annoText(2.6)}>JMB-4916-PP • QTY 1</text>

      {/* 3 — HINGE (×3 — qty accent) */}
      <rect x="430" y="240" width="160" height="54" rx="3" style={d(428, 2.0, 1.5)} />
      <line x1="430" y1="265" x2="590" y2="265" style={d(160, 2.2, 0.5)} />
      <text x="440" y="258" style={dimText(2.5)}>HINGE — 4&quot; SN</text>
      <text x="440" y="282" style={annoText(2.7)}>HW-HNG-4SN • QTY 3</text>

      {/* 4 — LOCKSET */}
      <rect x="610" y="240" width="160" height="54" rx="3" style={d(428, 2.1, 1.5)} />
      <line x1="610" y1="265" x2="770" y2="265" style={d(160, 2.3, 0.5)} />
      <text x="620" y="258" style={dimText(2.6)}>LOCKSET — EMTEK</text>
      <text x="620" y="282" style={annoText(2.8)}>EMT-LVR-SN • QTY 1</text>

      {/* 5 — WEATHERSTRIP KIT — dashed outline (alternate / optional spec) */}
      <rect
        x="790"
        y="240"
        width="160"
        height="54"
        rx="3"
        style={{ ...dd(428, 2.2, 1.2), strokeDasharray: '5,3' }}
      />
      <line x1="790" y1="265" x2="950" y2="265" style={dd(160, 2.4, 0.5)} />
      <text x="800" y="258" style={dimText(2.7)}>WEATHERSTRIP KIT</text>
      <text x="800" y="282" style={annoText(2.9)}>WS-KIT-STD • ALT</text>

      {/* 6 — THRESHOLD */}
      <rect x="970" y="240" width="160" height="54" rx="3" style={d(428, 2.3, 1.5)} />
      <line x1="970" y1="265" x2="1130" y2="265" style={d(160, 2.5, 0.5)} />
      <text x="980" y="258" style={dimText(2.8)}>THRESHOLD — ALUM</text>
      <text x="980" y="282" style={annoText(3.0)}>THR-ALM-36 • QTY 1</text>

      {/* ── Level 2: sub-components of DOOR SLAB (vertical stack) ───── */}
      {/* Dashed container around the L2 sub-tree zone */}
      <rect
        x="30"
        y="320"
        width="330"
        height="310"
        rx="2"
        style={{ ...dd(1280, 2.6, 0.4), strokeDasharray: '3,5' }}
      />

      {/* Cross-hatch fill inside L2 sub-tree zone */}
      <clipPath id="bom-l2-clip">
        <rect x="32" y="322" width="326" height="306" />
      </clipPath>
      <g clipPath="url(#bom-l2-clip)" style={{ opacity: 0.05 }}>
        {Array.from({ length: 30 }, (_, i) => (
          <line
            key={`l2h-${i}`}
            x1={30 + i * 12}
            y1="320"
            x2={30 + i * 12 - 40}
            y2="630"
            style={d(315, 3.5 + i * 0.02, 0.3)}
          />
        ))}
      </g>

      {/* Vertical spine from DOOR SLAB bottom down through L2 stack */}
      <line x1="150" y1="294" x2="150" y2="612" style={d(318, 2.8, 1)} />

      {/* L2 nodes — offset to right of spine with tick connectors */}
      {[
        { y: 340, label: 'TOP RAIL', meta: 'SLB-RL-TOP' },
        { y: 400, label: 'LOCK RAIL', meta: 'SLB-RL-LK' },
        { y: 460, label: 'BOTTOM RAIL', meta: 'SLB-RL-BOT' },
        { y: 520, label: 'STILES × 2', meta: 'SLB-ST-2' },
        { y: 580, label: 'PANELS × 6', meta: 'SLB-PN-6' },
      ].map((node, i) => (
        <g key={`l2-${i}`}>
          {/* tick from spine to node */}
          <line
            x1="150"
            y1={node.y + 16}
            x2="190"
            y2={node.y + 16}
            style={d(40, 3.0 + i * 0.15, 0.8)}
          />
          {/* junction dot on spine */}
          <circle
            cx="150"
            cy={node.y + 16}
            r="2.5"
            style={{
              fill: 'currentColor',
              fillOpacity: 0.4,
              stroke: 'none',
              opacity: 0,
              animation: `bp-fade 1.2s ease ${3.0 + i * 0.15}s forwards`,
            }}
          />
          {/* node box */}
          <rect
            x="190"
            y={node.y}
            width="150"
            height="32"
            rx="3"
            style={d(364, 3.1 + i * 0.15, 1.2)}
          />
          <text
            x="200"
            y={node.y + 14}
            style={{ ...dimText(3.4 + i * 0.15), fontSize: '8px' }}
          >
            {node.label}
          </text>
          <text
            x="200"
            y={node.y + 26}
            style={{ ...annoText(3.6 + i * 0.15), fontSize: '6px' }}
          >
            {node.meta}
          </text>
        </g>
      ))}

      <text x="40" y="650" style={annoText(5.5)}>DOOR SLAB — SUB-ASSEMBLY DETAIL</text>

      {/* ── Dimension callouts on the DOOR SLAB ─────────────────────── */}
      {/* Height dim (6'-8") — left of L2 stack */}
      <line x1="10" y1="340" x2="10" y2="612" style={dd(272, 4.7, 0.5)} />
      <line x1="5" y1="340" x2="15" y2="340" style={d(10, 4.7, 0.5)} />
      <line x1="5" y1="612" x2="15" y2="612" style={d(10, 4.7, 0.5)} />
      <text
        x="16"
        y="485"
        transform="rotate(-90,16,485)"
        style={annoText(5.2)}
      >
        6&apos;-8&quot; HEIGHT
      </text>

      {/* Width dim (3'-0") — below the L2 stack zone */}
      <line x1="30" y1="710" x2="360" y2="710" style={dd(330, 4.5, 0.5)} />
      <line x1="30" y1="705" x2="30" y2="715" style={d(10, 4.5, 0.5)} />
      <line x1="360" y1="705" x2="360" y2="715" style={d(10, 4.5, 0.5)} />
      <text x="140" y="725" style={annoText(5.0)}>3&apos;-0&quot; WIDTH</text>

      {/* Thickness callout (1-3/4") — diagonal leader off top-left */}
      <line x1="70" y1="248" x2="25" y2="215" style={dd(55, 4.6, 0.5)} />
      <circle
        cx="70"
        cy="248"
        r="2"
        style={{
          fill: 'currentColor',
          fillOpacity: 0.5,
          stroke: 'none',
          opacity: 0,
          animation: `bp-fade 1.2s ease 4.6s forwards`,
        }}
      />
      <text x="28" y="208" style={annoText(5.1)}>1-3/4&quot; THK</text>

      {/* ── Detail callout bubble — HARDWARE CLUSTER ────────────────── */}
      <circle cx="880" cy="440" r="80" style={d(503, 4.8, 0.7)} />
      {/* Two leader lines: one from HINGE, one from LOCKSET */}
      <line x1="510" y1="294" x2="820" y2="405" style={dd(340, 5.0, 0.5)} />
      <line x1="690" y1="294" x2="845" y2="395" style={dd(185, 5.1, 0.5)} />
      <text x="847" y="408" style={annoText(5.4)}>DETAIL H</text>
      <text x="830" y="445" style={{ ...dimText(5.6), fontSize: '8px' }}>HARDWARE CLUSTER</text>
      <text x="840" y="460" style={{ ...annoText(5.7), fontSize: '6px' }}>HINGE + LOCKSET</text>

      {/* Inside bubble: tiny hardware schematic */}
      <circle cx="865" cy="480" r="8" style={d(50, 5.8, 0.8)} />
      <circle cx="865" cy="480" r="3" style={d(19, 6.0, 0.6)} />
      <rect x="895" y="472" width="10" height="18" rx="2" style={d(56, 6.0, 0.6)} />
      <line x1="878" y1="480" x2="890" y2="480" style={dd(12, 6.1, 0.4)} />

      {/* ── Overall horizontal span annotation ──────────────────────── */}
      <line x1="70" y1="680" x2="1130" y2="680" style={dd(1060, 5.2, 0.5)} />
      <line x1="70" y1="675" x2="70" y2="685" style={d(10, 5.2, 0.5)} />
      <line x1="1130" y1="675" x2="1130" y2="685" style={d(10, 5.2, 0.5)} />
      <text x="440" y="696" style={annoText(5.8)}>TOTAL LINE ITEMS — 11 • ASSY COST Σ VAR</text>

      {/* ── Legend — bottom right under L1 row ──────────────────────── */}
      <rect x="960" y="500" width="210" height="100" rx="2" style={d(620, 5.5, 0.6)} />
      <line x1="960" y1="520" x2="1170" y2="520" style={d(210, 5.7, 0.4)} />
      <text x="970" y="515" style={annoText(6.0)}>LEGEND</text>

      <line x1="975" y1="540" x2="1005" y2="540" style={d(30, 6.1, 1.5)} />
      <text x="1015" y="543" style={{ ...dimText(6.2), fontSize: '7px' }}>PARENT → CHILD</text>

      <line
        x1="975"
        y1="560"
        x2="1005"
        y2="560"
        style={{ ...dd(30, 6.2, 1), strokeDasharray: '5,3' }}
      />
      <text x="1015" y="563" style={{ ...dimText(6.3), fontSize: '7px' }}>ALT / OPTIONAL</text>

      <circle cx="989" cy="580" r="6" style={d(38, 6.3, 0.8)} />
      <text x="1015" y="583" style={{ ...dimText(6.4), fontSize: '7px' }}>QTY CALLOUT</text>
      <text x="975" y="596" style={{ ...annoText(6.5), fontSize: '6px' }}>PER BomEntry ROW</text>

      {/* ── Grid reference — letters along the bottom edge ──────────── */}
      {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'].map((letter, i) => (
        <g key={letter}>
          <line
            x1={60 + i * 110}
            y1="770"
            x2={60 + i * 110}
            y2="760"
            style={d(10, 0.2, 0.3)}
          />
          <text
            x={55 + i * 110}
            y="782"
            style={{ ...annoText(0.5 + i * 0.1), fontSize: '6px' }}
          >
            {letter}
          </text>
        </g>
      ))}

      {/* ── Grid reference — numbers along the left edge ────────────── */}
      {['1', '2', '3', '4', '5', '6', '7', '8'].map((n, i) => (
        <g key={`gn-${n}`}>
          <line x1={20} y1={60 + i * 90} x2={10} y2={60 + i * 90} style={d(10, 0.25, 0.3)} />
          <text
            x={6}
            y={64 + i * 90}
            style={{
              ...annoText(0.6 + i * 0.05),
              fontSize: '6px',
              textAnchor: 'end' as const,
            }}
          >
            {n}
          </text>
        </g>
      ))}

      {/* ── Pulse dots on key nodes ─────────────────────────────────── */}
      {pulseDot(600, 120, 'var(--c1)', 0)}
      {pulseDot(510, 267, 'var(--c2)', -1.5)}
      {pulseDot(150, 267, 'var(--c3)', -2.5)}
    </svg>
  )
}

/* ── Wrapping container (fixed, pointer-events-none, reduced-motion) ── */

function BOMBlueprintImpl({ className = '', opacity = 0.12 }: BOMBlueprintBackgroundProps) {
  return (
    <>
      {/* Scoped reduced-motion override — existing globals.css keyframes
          are kept intact; this just freezes the final frame when the user
          has prefers-reduced-motion: reduce. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .bom-bp-bg * {
            animation: none !important;
            stroke-dashoffset: 0 !important;
            opacity: 1 !important;
          }
        }
      `}</style>
      <div
        className={`fixed inset-0 pointer-events-none overflow-hidden bom-bp-bg ${className}`}
        style={{ zIndex: 0, opacity }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: 'var(--fg)' }}
        >
          <div className="w-[92vw] h-[86vh] max-w-[1500px] max-h-[1000px]">
            <BomBlueprintSVG />
          </div>
        </div>
      </div>
    </>
  )
}

export default memo(BOMBlueprintImpl)
export { BomBlueprintSVG, BOMBlueprintImpl as BOMBlueprintBackground }
