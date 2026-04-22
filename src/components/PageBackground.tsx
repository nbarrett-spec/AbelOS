'use client'

/**
 * PageBackground — section-specific animated SVG blueprints.
 *
 * Layers on top of PortalBackground (which stays fixed behind all content).
 * Positioned absolute so it scrolls with the page content — unlike
 * PortalBackground which is fixed.
 *
 * Opacity 0.15 so it adds section flavor without fighting the portal
 * background or the foreground.
 *
 * Uses the same stroke-draw animation helpers as PortalBackground:
 *   - d()       solid stroke w/ draw-in
 *   - dd()      dashed variant
 *   - dimText() small dimension label
 *   - annoText() all-caps annotation
 *   - pulseDot() animated dot
 *
 * Respects prefers-reduced-motion (scoped <style> block below).
 */

import { memo, type ComponentType, type ReactNode } from 'react'

// ── Section key type ──────────────────────────────────────────────────────
export type PageSection =
  | 'manufacturing'
  | 'delivery'
  | 'warehouse'
  | 'finance'
  | 'purchasing'
  | 'sales'
  | 'jobs'
  | 'quality'
  | 'ai'
  | 'communications'
  | 'documents'
  | 'hr'
  | 'integrations'
  | 'reporting'
  | 'admin-builders'
  | 'admin-products'
  | 'admin-monitoring'
  | 'builder-orders'
  | 'builder-projects'
  | 'builder-finance'
  | 'builder-account'
  | 'crew'
  | 'default'

interface PageBackgroundProps {
  section: PageSection
  className?: string
}

// ── Shared helpers (mirror PortalBackground) ──────────────────────────────
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

const dd = (length: number, delay: number = 0, width: number = 0.8) => ({
  ...d(length, delay, width),
  strokeDasharray: '6,4',
})

const dimText = (delay: number = 0) => ({
  fill: 'currentColor',
  fontFamily: "'Azeret Mono', monospace",
  fontSize: '9px',
  letterSpacing: '0.08em',
  opacity: 0,
  animation: `bp-fade 1.5s ease ${delay}s forwards`,
})

const annoText = (delay: number = 0) => ({
  ...dimText(delay),
  fontSize: '7px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.15em',
})

const pulseDot = (cx: number, cy: number, delay: number, r: number = 3) => (
  <circle
    key={`p-${cx}-${cy}`}
    cx={cx} cy={cy} r={r}
    style={{
      fill: 'currentColor',
      opacity: 0.55,
      animation: `bp-pulse 3s ease-in-out ${delay}s infinite`,
    }}
  />
)

// ── Shared frame: border + corner marks + title block ─────────────────────
function Frame({ title, rev, sheet }: { title: string; rev: string; sheet: string }) {
  return (
    <>
      {/* Border */}
      <rect x="20" y="20" width="1560" height="960" style={d(5040, 0, 0.6)} />
      {/* Corner registration marks */}
      <path d="M 40 40 L 60 40 M 40 40 L 40 60" style={d(40, 0.2, 0.8)} />
      <path d="M 1560 40 L 1540 40 M 1560 40 L 1560 60" style={d(40, 0.3, 0.8)} />
      <path d="M 40 960 L 60 960 M 40 960 L 40 940" style={d(40, 0.4, 0.8)} />
      <path d="M 1560 960 L 1540 960 M 1560 960 L 1560 940" style={d(40, 0.5, 0.8)} />
      {/* Title block */}
      <rect x="1260" y="40" width="320" height="80" style={d(800, 0.4, 0.6)} />
      <line x1="1260" y1="70" x2="1580" y2="70" style={d(320, 0.6, 0.5)} />
      <line x1="1260" y1="96" x2="1580" y2="96" style={d(320, 0.7, 0.5)} />
      <text x="1276" y="62" style={annoText(1.2)}>{title}</text>
      <text x="1276" y="88" style={dimText(1.4)}>{rev}</text>
      <text x="1276" y="114" style={dimText(1.5)}>{sheet}</text>
    </>
  )
}

// ── Grid reference (A-H columns, 1-6 rows) ────────────────────────────────
function GridRefs() {
  return (
    <g style={{ opacity: 0.6 }}>
      {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((l, i) => (
        <text key={l} x={60 + i * 190} y={16} style={{ ...dimText(1.8 + i * 0.05), fontSize: '8px' }}>{l}</text>
      ))}
      {[1, 2, 3, 4, 5].map((n, i) => (
        <text key={n} x={12} y={80 + i * 190} style={{ ...dimText(1.9 + i * 0.05), fontSize: '8px' }}>{n}</text>
      ))}
    </g>
  )
}

/* ═══════════════════════════════════════════════════════════════════════ */
/* SECTION BACKGROUNDS                                                     */
/* ═══════════════════════════════════════════════════════════════════════ */

/* ── MANUFACTURING: exploded 6-panel door assembly ──────────────────────── */
function ManufacturingBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — MFG LINE SCHEMATIC" rev="REV 08 — APR 2026" sheet="SHT 01 / MFG" />
      <GridRefs />

      {/* Assembled door outline (left) */}
      <rect x="160" y="240" width="280" height="560" style={d(1680, 0.4, 1.4)} />
      {/* Stiles */}
      <line x1="190" y1="240" x2="190" y2="800" style={d(560, 0.7, 0.6)} />
      <line x1="410" y1="240" x2="410" y2="800" style={d(560, 0.8, 0.6)} />
      {/* Rails */}
      <line x1="190" y1="280" x2="410" y2="280" style={d(220, 0.9, 0.6)} />
      <line x1="190" y1="420" x2="410" y2="420" style={d(220, 1.0, 0.6)} />
      <line x1="190" y1="560" x2="410" y2="560" style={d(220, 1.1, 0.6)} />
      <line x1="190" y1="760" x2="410" y2="760" style={d(220, 1.2, 0.6)} />
      {/* Panels */}
      {[310, 470, 630].map((y, i) => (
        <g key={y}>
          <rect x="200" y={y - 20} width="90" height="90" style={d(360, 1.3 + i * 0.1, 0.5)} />
          <rect x="310" y={y - 20} width="90" height="90" style={d(360, 1.35 + i * 0.1, 0.5)} />
        </g>
      ))}
      {/* Dimensions */}
      <line x1="160" y1="830" x2="440" y2="830" style={d(280, 1.8, 0.5)} />
      <text x="285" y="844" style={annoText(2.2)}>3'-0" W</text>
      <line x1="460" y1="240" x2="460" y2="800" style={d(560, 1.9, 0.5)} />
      <text x="468" y="520" style={annoText(2.3)}>6'-8" H</text>

      {/* Process flow (right) — raw → machine → QC → stage */}
      {[
        { x: 600, label: 'RAW' },
        { x: 800, label: 'CUT' },
        { x: 1000, label: 'MACH' },
        { x: 1200, label: 'QC' },
        { x: 1400, label: 'STAGE' },
      ].map((s, i) => (
        <g key={s.label}>
          <rect x={s.x - 50} y="400" width="100" height="60" style={d(320, 0.6 + i * 0.15, 0.8)} />
          <text x={s.x} y="436" textAnchor="middle" style={annoText(1.4 + i * 0.1)}>{s.label}</text>
          {i < 4 && (
            <>
              <line x1={s.x + 50} y1="430" x2={s.x + 150} y2="430" style={d(100, 1.2 + i * 0.1, 0.7)} />
              <path d={`M ${s.x + 145} 425 L ${s.x + 155} 430 L ${s.x + 145} 435`} style={d(20, 1.3 + i * 0.1, 0.7)} />
            </>
          )}
        </g>
      ))}
      {pulseDot(800, 430, 2.4, 4)}
      {pulseDot(1200, 430, 2.8, 4)}

      {/* Gantt strip (bottom) */}
      <line x1="600" y1="600" x2="1400" y2="600" style={d(800, 1.4, 0.5)} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
        <line key={n} x1={600 + n * 100} y1="600" x2={600 + n * 100} y2="610" style={d(10, 1.5 + n * 0.05, 0.4)} />
      ))}
      <rect x="620" y="620" width="140" height="16" style={d(312, 2.0, 0.6)} />
      <rect x="780" y="640" width="220" height="16" style={d(472, 2.15, 0.6)} />
      <rect x="1020" y="660" width="180" height="16" style={d(392, 2.3, 0.6)} />
      <text x="600" y="700" style={annoText(2.8)}>SCHEDULE — WEEK 17 LOAD</text>

      <Reduced />
    </svg>
  )
}

/* ── DELIVERY: box truck + route line ───────────────────────────────────── */
function DeliveryBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — DELIVERY ROUTE" rev="REV 02 — APR 2026" sheet="SHT 01 / DLV" />
      <GridRefs />

      {/* Truck silhouette */}
      <rect x="180" y="380" width="360" height="200" style={d(1120, 0.5, 1.4)} />
      <rect x="540" y="420" width="120" height="160" style={d(560, 0.8, 1.2)} />
      <rect x="560" y="440" width="80" height="60" style={d(280, 1.0, 0.8)} />
      <circle cx="260" cy="600" r="36" style={d(226, 1.2, 1.2)} />
      <circle cx="260" cy="600" r="18" style={d(113, 1.4, 0.8)} />
      <circle cx="580" cy="600" r="36" style={d(226, 1.3, 1.2)} />
      <circle cx="580" cy="600" r="18" style={d(113, 1.5, 0.8)} />
      {/* Cargo grid inside */}
      {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => (
        <rect key={`${r}-${c}`} x={200 + c * 80} y={400 + r * 56} width="72" height="48" style={d(240, 1.6 + r * 0.08 + c * 0.04, 0.5)} />
      )))}
      <text x="180" y="370" style={annoText(2.0)}>UNIT — F250-03</text>

      {/* Route line — stylized city grid with stops */}
      <path d="M 780 600 L 900 600 L 900 500 L 1040 500 L 1040 400 L 1180 400 L 1180 500 L 1320 500 L 1320 600 L 1440 600" style={d(800, 0.8, 1.4)} />
      {/* Stops */}
      {[
        { x: 780, y: 600, label: 'WH' },
        { x: 1040, y: 400, label: 'STOP 1' },
        { x: 1180, y: 500, label: 'STOP 2' },
        { x: 1440, y: 600, label: 'STOP 3' },
      ].map((s, i) => (
        <g key={s.label}>
          <circle cx={s.x} cy={s.y} r="10" style={d(63, 2.0 + i * 0.15, 1.2)} />
          <text x={s.x + 16} y={s.y + 4} style={annoText(2.4 + i * 0.1)}>{s.label}</text>
        </g>
      ))}
      {pulseDot(1040, 400, 3.2, 4)}
      {pulseDot(1440, 600, 3.6, 4)}

      {/* Compass rose */}
      <g transform="translate(1300, 180)">
        <circle cx="0" cy="0" r="48" style={d(302, 1.5, 0.8)} />
        <path d="M 0 -40 L 6 0 L 0 40 L -6 0 Z" style={d(160, 2.0, 0.8)} />
        <text x="0" y="-52" textAnchor="middle" style={annoText(2.5)}>N</text>
        <text x="58" y="4" style={annoText(2.5)}>E</text>
      </g>

      {/* Legend */}
      <text x="60" y="900" style={annoText(3.0)}>LEGEND</text>
      <line x1="60" y1="920" x2="100" y2="920" style={d(40, 3.2, 1.4)} />
      <text x="108" y="924" style={dimText(3.3)}>ROUTE</text>
      <circle cx="200" cy="920" r="5" style={d(32, 3.4, 1)} />
      <text x="212" y="924" style={dimText(3.5)}>STOP</text>

      <Reduced />
    </svg>
  )
}

/* ── WAREHOUSE: bay floor plan ──────────────────────────────────────────── */
function WarehouseBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — WAREHOUSE PLAN" rev="REV 04 — APR 2026" sheet="SHT 01 / WH" />
      <GridRefs />

      {/* Outer building */}
      <rect x="100" y="180" width="1400" height="680" style={d(4160, 0.4, 1.5)} />
      {/* Dock doors (top) */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={180 + i * 220} y="160" width="120" height="20" style={d(280, 0.6 + i * 0.08, 1.0)} />
      ))}
      {/* Bay rows */}
      {[0, 1, 2].map((row) => (
        <g key={row}>
          {[0, 1, 2, 3, 4, 5].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={140 + col * 220}
              y={240 + row * 200}
              width="180"
              height="140"
              style={d(640, 0.8 + row * 0.12 + col * 0.05, 0.7)}
            />
          ))}
          <text x="120" y={315 + row * 200} style={annoText(2.0 + row * 0.15)}>ROW {row + 1}</text>
        </g>
      ))}
      {/* Aisle markers */}
      {[220, 420, 620].map((y, i) => (
        <line key={y} x1="100" y1={y} x2="1500" y2={y} style={dd(1400, 1.4 + i * 0.1, 0.4)} />
      ))}
      {/* Bay labels */}
      {[0, 1, 2, 3, 4, 5].map((col) => (
        <text key={col} x={230 + col * 220} y="210" textAnchor="middle" style={{ ...dimText(2.4 + col * 0.05), fontSize: '8px' }}>
          B{col + 1}
        </text>
      ))}
      {/* Dock dimension */}
      <line x1="100" y1="880" x2="1500" y2="880" style={d(1400, 3.0, 0.5)} />
      <text x="800" y="898" textAnchor="middle" style={annoText(3.4)}>280'-0" OVERALL</text>

      {/* Pick path arrows */}
      <path d="M 180 440 L 360 440 L 360 640 L 800 640 L 800 440 L 1400 440" style={dd(1260, 2.0, 0.7)} />
      {pulseDot(180, 440, 3.0, 4)}
      {pulseDot(1400, 440, 3.4, 4)}

      <Reduced />
    </svg>
  )
}

/* ── FINANCE: ledger columns + trend lines ──────────────────────────────── */
function FinanceBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — FINANCIAL LEDGER" rev="REV 06 — APR 2026" sheet="SHT 01 / FIN" />
      <GridRefs />

      {/* Ledger columns (left) */}
      <rect x="80" y="180" width="600" height="640" style={d(2480, 0.4, 0.8)} />
      <line x1="80" y1="220" x2="680" y2="220" style={d(600, 0.6, 0.6)} />
      <line x1="320" y1="180" x2="320" y2="820" style={d(640, 0.7, 0.5)} />
      <line x1="500" y1="180" x2="500" y2="820" style={d(640, 0.75, 0.5)} />
      <text x="110" y="208" style={annoText(1.4)}>ACCOUNT</text>
      <text x="360" y="208" style={annoText(1.5)}>DEBIT</text>
      <text x="540" y="208" style={annoText(1.6)}>CREDIT</text>
      {/* Rows */}
      {['CASH', 'AR', 'INVENTORY', 'AP', 'REVENUE', 'COGS', 'OPEX', 'PAYROLL', 'TAX', 'OWNER EQ'].map((r, i) => (
        <g key={r}>
          <line x1="80" y1={260 + i * 56} x2="680" y2={260 + i * 56} style={d(600, 0.9 + i * 0.05, 0.3)} />
          <text x="110" y={284 + i * 56} style={dimText(1.8 + i * 0.05)}>{r}</text>
          <text x="360" y={284 + i * 56} style={dimText(1.9 + i * 0.05)}>$—</text>
          <text x="540" y={284 + i * 56} style={dimText(2.0 + i * 0.05)}>$—</text>
        </g>
      ))}

      {/* Trend chart (right) */}
      <rect x="800" y="180" width="720" height="300" style={d(2040, 0.5, 0.8)} />
      {/* Axis */}
      <line x1="820" y1="460" x2="1500" y2="460" style={d(680, 0.8, 0.7)} />
      <line x1="820" y1="200" x2="820" y2="460" style={d(260, 0.9, 0.7)} />
      {/* Gridlines */}
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1="820" y1={460 - i * 52} x2="1500" y2={460 - i * 52} style={dd(680, 1.0 + i * 0.05, 0.3)} />
      ))}
      {/* Trend line */}
      <path d="M 820 400 L 920 380 L 1020 340 L 1120 360 L 1220 300 L 1320 280 L 1420 250 L 1500 220" style={d(740, 1.8, 1.4)} />
      {/* Bars underneath */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={860 + i * 90} y={440 - (i * 8 + 20)} width="32" height={(i * 8 + 20)} style={d((i * 8 + 20) * 2 + 64, 2.2 + i * 0.08, 0.5)} />
      ))}
      <text x="820" y="168" style={annoText(2.8)}>REVENUE TREND — 7MO</text>

      {/* KPI boxes (bottom right) */}
      {[
        { x: 800, label: 'CASH', val: '$—' },
        { x: 980, label: 'AR', val: '$—' },
        { x: 1160, label: 'DSO', val: '—d' },
        { x: 1340, label: 'MARGIN', val: '—%' },
      ].map((k, i) => (
        <g key={k.label}>
          <rect x={k.x} y="540" width="160" height="100" style={d(520, 1.2 + i * 0.1, 0.7)} />
          <text x={k.x + 14} y="564" style={annoText(1.8 + i * 0.1)}>{k.label}</text>
          <text x={k.x + 14} y="614" style={{ ...dimText(2.0 + i * 0.1), fontSize: '18px' }}>{k.val}</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── PURCHASING: PO form with line items ────────────────────────────────── */
function PurchasingBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — PURCHASE ORDER" rev="REV 03 — APR 2026" sheet="SHT 01 / PO" />
      <GridRefs />

      {/* PO header */}
      <rect x="120" y="180" width="1360" height="120" style={d(2960, 0.4, 0.8)} />
      <text x="150" y="220" style={{ ...annoText(1.2), fontSize: '14px' }}>PURCHASE ORDER</text>
      <text x="150" y="250" style={dimText(1.4)}>PO # ________________</text>
      <text x="150" y="280" style={dimText(1.5)}>VENDOR: _____________</text>
      <text x="800" y="250" style={dimText(1.6)}>DATE: _____________</text>
      <text x="800" y="280" style={dimText(1.7)}>TERMS: NET 30</text>
      <text x="1200" y="250" style={dimText(1.8)}>SHIP TO: ABEL LUMBER</text>
      <text x="1200" y="280" style={dimText(1.9)}>DFW DC</text>

      {/* Line items table */}
      <rect x="120" y="340" width="1360" height="440" style={d(3600, 0.7, 0.8)} />
      <line x1="120" y1="380" x2="1480" y2="380" style={d(1360, 0.9, 0.6)} />
      {/* Column headers */}
      <text x="140" y="368" style={annoText(1.4)}>LINE</text>
      <text x="220" y="368" style={annoText(1.5)}>SKU</text>
      <text x="420" y="368" style={annoText(1.55)}>DESCRIPTION</text>
      <text x="900" y="368" style={annoText(1.6)}>QTY</text>
      <text x="1060" y="368" style={annoText(1.65)}>UNIT</text>
      <text x="1220" y="368" style={annoText(1.7)}>EXT</text>
      {/* Column dividers */}
      {[200, 400, 880, 1040, 1200].map((x, i) => (
        <line key={x} x1={x} y1="340" x2={x} y2="780" style={d(440, 1.0 + i * 0.05, 0.4)} />
      ))}
      {/* Rows */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <g key={i}>
          <line x1="120" y1={420 + i * 44} x2="1480" y2={420 + i * 44} style={d(1360, 1.2 + i * 0.08, 0.25)} />
          <text x="140" y={410 + i * 44} style={dimText(1.5 + i * 0.08)}>{i + 1}</text>
          <text x="220" y={410 + i * 44} style={dimText(1.55 + i * 0.08)}>___-___</text>
        </g>
      ))}
      {/* Total block */}
      <rect x="1100" y="800" width="380" height="100" style={d(960, 2.0, 0.7)} />
      <text x="1120" y="830" style={annoText(2.4)}>SUBTOTAL</text>
      <text x="1400" y="830" style={dimText(2.5)}>$—</text>
      <text x="1120" y="858" style={annoText(2.6)}>FREIGHT</text>
      <text x="1400" y="858" style={dimText(2.7)}>$—</text>
      <text x="1120" y="888" style={{ ...annoText(2.8), fontSize: '10px' }}>TOTAL</text>
      <text x="1400" y="888" style={{ ...dimText(2.9), fontSize: '12px' }}>$—</text>

      {pulseDot(1080, 888, 3.2, 4)}

      <Reduced />
    </svg>
  )
}

/* ── SALES: pipeline funnel ─────────────────────────────────────────────── */
function SalesBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — SALES PIPELINE" rev="REV 05 — APR 2026" sheet="SHT 01 / SLS" />
      <GridRefs />

      {/* Funnel shape */}
      {[
        { w: 900, y: 220, label: 'LEADS', count: '247' },
        { w: 720, y: 320, label: 'QUALIFIED', count: '118' },
        { w: 540, y: 420, label: 'PROPOSAL', count: '54' },
        { w: 360, y: 520, label: 'NEGOTIATION', count: '22' },
        { w: 180, y: 620, label: 'CLOSED-WON', count: '9' },
      ].map((s, i) => (
        <g key={s.label}>
          <rect x={800 - s.w / 2} y={s.y} width={s.w} height="80" style={d(s.w * 2 + 160, 0.5 + i * 0.15, 1.0)} />
          <text x="800" y={s.y + 36} textAnchor="middle" style={{ ...annoText(1.2 + i * 0.15), fontSize: '10px' }}>
            {s.label}
          </text>
          <text x="800" y={s.y + 62} textAnchor="middle" style={{ ...dimText(1.4 + i * 0.15), fontSize: '14px' }}>
            {s.count}
          </text>
          {/* Dropoff annotation */}
          {i < 4 && (
            <text x={800 + s.w / 2 + 20} y={s.y + 90} style={annoText(2.4 + i * 0.1)}>
              ↓ —{Math.round(100 - (([118, 54, 22, 9][i] / [247, 118, 54, 22][i]) * 100))}%
            </text>
          )}
        </g>
      ))}

      {/* Deal board (right) */}
      <rect x="1200" y="200" width="360" height="500" style={d(1720, 0.6, 0.8)} />
      <text x="1220" y="230" style={annoText(1.6)}>TOP DEALS</text>
      <line x1="1220" y1="245" x2="1540" y2="245" style={d(320, 1.0, 0.5)} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <rect x="1220" y={265 + i * 70} width="320" height="56" style={d(752, 1.4 + i * 0.08, 0.5)} />
          <text x="1234" y={288 + i * 70} style={{ ...annoText(1.6 + i * 0.08), fontSize: '8px' }}>BUILDER {String.fromCharCode(65 + i)}</text>
          <text x="1234" y={310 + i * 70} style={dimText(1.7 + i * 0.08)}>$___,___ · STG</text>
        </g>
      ))}

      {/* Rep scorecards (bottom) */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={120 + i * 260} y="780" width="240" height="140" style={d(760, 1.8 + i * 0.12, 0.7)} />
          <text x={140 + i * 260} y="810" style={annoText(2.2 + i * 0.12)}>REP {i + 1}</text>
          <line x1={140 + i * 260} y1="820" x2={340 + i * 260} y2="820" style={d(200, 2.4 + i * 0.12, 0.4)} />
          <text x={140 + i * 260} y="846" style={dimText(2.5 + i * 0.12)}>QUOTA</text>
          <text x={300 + i * 260} y="846" style={dimText(2.55 + i * 0.12)}>—%</text>
          <text x={140 + i * 260} y="872" style={dimText(2.6 + i * 0.12)}>CLOSED</text>
          <text x={300 + i * 260} y="872" style={dimText(2.65 + i * 0.12)}>$—</text>
          <text x={140 + i * 260} y="898" style={dimText(2.7 + i * 0.12)}>PIPELINE</text>
          <text x={300 + i * 260} y="898" style={dimText(2.75 + i * 0.12)}>$—</text>
        </g>
      ))}

      {pulseDot(800, 652, 3.2, 5)}

      <Reduced />
    </svg>
  )
}

/* ── JOBS: Gantt chart ──────────────────────────────────────────────────── */
function JobsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — JOB SCHEDULE" rev="REV 04 — APR 2026" sheet="SHT 01 / JOB" />
      <GridRefs />

      {/* Day columns */}
      <rect x="300" y="180" width="1200" height="680" style={d(3760, 0.4, 0.8)} />
      <line x1="300" y1="220" x2="1500" y2="220" style={d(1200, 0.6, 0.6)} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <g key={i}>
          <line x1={300 + i * 120} y1="180" x2={300 + i * 120} y2="860" style={dd(680, 0.8 + i * 0.04, 0.3)} />
          <text x={360 + i * 120} y="208" textAnchor="middle" style={annoText(1.2 + i * 0.05)}>DAY {i + 1}</text>
        </g>
      ))}
      {/* Job rows */}
      {[
        { y: 260, start: 300, w: 360, label: 'JOB 4401 — FRAMING' },
        { y: 310, start: 420, w: 480, label: 'JOB 4402 — DOORS' },
        { y: 360, start: 240, w: 300, label: 'JOB 4403 — TRIM', offset: 60 },
        { y: 410, start: 600, w: 540, label: 'JOB 4404 — HARDWARE' },
        { y: 460, start: 720, w: 240, label: 'JOB 4405 — INSPECT' },
        { y: 510, start: 360, w: 480, label: 'JOB 4406 — FINISH' },
        { y: 560, start: 840, w: 360, label: 'JOB 4407 — PUNCH' },
        { y: 610, start: 540, w: 420, label: 'JOB 4408 — DELIVER' },
      ].map((j, i) => (
        <g key={i}>
          <rect x={j.start} y={j.y} width={j.w} height="32" style={d(j.w * 2 + 64, 1.0 + i * 0.12, 0.8)} />
          <text x="120" y={j.y + 22} style={annoText(1.4 + i * 0.1)}>{j.label}</text>
        </g>
      ))}
      {/* Dependency arrows */}
      <path d="M 660 276 L 700 276 L 700 326" style={d(90, 2.2, 0.6)} />
      <path d="M 900 326 L 940 326 L 940 376" style={d(90, 2.4, 0.6)} />
      <path d="M 840 526 L 880 526 L 880 576" style={d(90, 2.6, 0.6)} />

      {/* Milestone diamonds */}
      {[{ x: 660, y: 276 }, { x: 840, y: 526 }, { x: 1200, y: 576 }].map((m, i) => (
        <g key={i}>
          <path d={`M ${m.x} ${m.y - 8} L ${m.x + 8} ${m.y} L ${m.x} ${m.y + 8} L ${m.x - 8} ${m.y} Z`} style={d(45, 2.8 + i * 0.1, 0.8)} />
          {pulseDot(m.x, m.y, 3.4 + i * 0.1, 3)}
        </g>
      ))}

      {/* Legend */}
      <text x="120" y="900" style={annoText(3.0)}>◆ MILESTONE</text>
      <text x="320" y="900" style={annoText(3.1)}>── CRITICAL PATH</text>

      <Reduced />
    </svg>
  )
}

/* ── QUALITY: magnifying glass + cross-section ──────────────────────────── */
function QualityBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — QUALITY CONTROL" rev="REV 03 — APR 2026" sheet="SHT 01 / QC" />
      <GridRefs />

      {/* Magnifying glass */}
      <circle cx="360" cy="360" r="180" style={d(1131, 0.5, 1.6)} />
      <circle cx="360" cy="360" r="160" style={d(1005, 0.7, 0.5)} />
      <line x1="500" y1="500" x2="640" y2="640" style={d(200, 1.4, 3.0)} />
      <line x1="500" y1="500" x2="640" y2="640" style={d(200, 1.6, 1.4)} />
      {/* Crosshair inside */}
      <line x1="200" y1="360" x2="520" y2="360" style={dd(320, 1.8, 0.4)} />
      <line x1="360" y1="200" x2="360" y2="520" style={dd(320, 1.9, 0.4)} />
      <circle cx="360" cy="360" r="40" style={d(252, 2.0, 0.6)} />
      {pulseDot(360, 360, 2.4, 5)}

      {/* Cross-section drawing (right) */}
      <text x="780" y="200" style={annoText(1.4)}>DOOR CROSS-SECTION — DETAIL A</text>
      {/* Slab cross section */}
      <rect x="780" y="240" width="700" height="120" style={d(1640, 0.8, 1.2)} />
      {/* Skin */}
      <line x1="780" y1="260" x2="1480" y2="260" style={d(700, 1.2, 0.5)} />
      <line x1="780" y1="340" x2="1480" y2="340" style={d(700, 1.3, 0.5)} />
      {/* Core hatch */}
      <g>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => (
          <line
            key={i}
            x1={780 + i * 50}
            y1="260"
            x2={830 + i * 50}
            y2="340"
            style={d(94, 1.6 + i * 0.04, 0.3)}
          />
        ))}
      </g>
      <text x="780" y="386" style={dimText(2.2)}>1-3/4" THICK · POLY CORE · HDF SKIN</text>

      {/* Inspection checklist (bottom) */}
      <rect x="120" y="640" width="700" height="300" style={d(2000, 0.9, 0.8)} />
      <text x="140" y="672" style={annoText(1.6)}>INSPECTION CHECKLIST</text>
      <line x1="140" y1="684" x2="800" y2="684" style={d(660, 1.2, 0.5)} />
      {['DIMENSIONS ± 1/16"', 'SQUARENESS', 'SURFACE DEFECTS', 'HARDWARE PREP', 'STAIN/FINISH', 'WEATHERSTRIP SEAT'].map((item, i) => (
        <g key={i}>
          <rect x="160" y={700 + i * 34} width="18" height="18" style={d(72, 1.6 + i * 0.1, 0.7)} />
          <text x="192" y={714 + i * 34} style={dimText(1.8 + i * 0.1)}>{item}</text>
        </g>
      ))}

      {/* Defect rate chart */}
      <rect x="880" y="640" width="600" height="300" style={d(1800, 1.0, 0.8)} />
      <text x="900" y="672" style={annoText(1.8)}>DEFECT RATE — 12WK</text>
      <line x1="900" y1="900" x2="1460" y2="900" style={d(560, 1.5, 0.6)} />
      <line x1="900" y1="720" x2="900" y2="900" style={d(180, 1.6, 0.6)} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
        <rect
          key={i}
          x={920 + i * 44}
          y={900 - (30 - (i % 4) * 6)}
          width="30"
          height={30 - (i % 4) * 6}
          style={d((30 - (i % 4) * 6) * 2 + 60, 2.0 + i * 0.06, 0.5)}
        />
      ))}

      <Reduced />
    </svg>
  )
}

/* ── AI: neural network nodes ───────────────────────────────────────────── */
function AiBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — NUC AI ENGINE" rev="REV 02 — APR 2026" sheet="SHT 01 / AI" />
      <GridRefs />

      {/* 4-layer neural net */}
      {(() => {
        const layers = [
          { x: 240, count: 5, label: 'INPUT' },
          { x: 560, count: 7, label: 'HIDDEN 1' },
          { x: 880, count: 7, label: 'HIDDEN 2' },
          { x: 1200, count: 4, label: 'OUTPUT' },
        ]
        const nodePositions = layers.map((l) =>
          Array.from({ length: l.count }, (_, i) => ({
            x: l.x,
            y: 200 + ((700 - (l.count - 1) * 80) / 2) + i * 80,
          }))
        )
        const elements: ReactNode[] = []
        // Connections
        for (let li = 0; li < layers.length - 1; li++) {
          const a = nodePositions[li]
          const b = nodePositions[li + 1]
          for (let i = 0; i < a.length; i++) {
            for (let j = 0; j < b.length; j++) {
              const dx = b[j].x - a[i].x
              const dy = b[j].y - a[i].y
              const len = Math.sqrt(dx * dx + dy * dy)
              elements.push(
                <line
                  key={`c-${li}-${i}-${j}`}
                  x1={a[i].x} y1={a[i].y} x2={b[j].x} y2={b[j].y}
                  style={d(len, 0.6 + li * 0.1 + (i + j) * 0.02, 0.25)}
                />
              )
            }
          }
        }
        // Nodes
        layers.forEach((l, li) => {
          nodePositions[li].forEach((p, i) => {
            elements.push(
              <g key={`n-${li}-${i}`}>
                <circle cx={p.x} cy={p.y} r="14" style={d(88, 1.4 + li * 0.15 + i * 0.04, 1.2)} />
                {(li === 1 || li === 2) && pulseDot(p.x, p.y, 2.0 + li * 0.1 + i * 0.05, 2)}
              </g>
            )
          })
          elements.push(
            <text key={`l-${li}`} x={l.x} y={900} textAnchor="middle" style={annoText(2.4 + li * 0.1)}>
              {l.label}
            </text>
          )
        })
        return elements
      })()}

      {/* Coordinator tag */}
      <rect x="80" y="180" width="220" height="80" style={d(600, 0.4, 0.8)} />
      <text x="100" y="210" style={annoText(1.6)}>NUC COORDINATOR</text>
      <text x="100" y="234" style={dimText(1.8)}>100.84.113.47</text>
      <text x="100" y="252" style={dimText(1.9)}>ONLINE · REDIS · FASTAPI</text>

      {/* Workers */}
      {['SALES', 'MARKETING', 'OPS', 'CUSTOMER'].map((w, i) => (
        <g key={w}>
          <rect x={1320} y={200 + i * 80} width="240" height="60" style={d(600, 1.4 + i * 0.1, 0.7)} />
          <text x={1332} y={224 + i * 80} style={annoText(1.8 + i * 0.1)}>NUC #{i + 1}</text>
          <text x={1332} y={248 + i * 80} style={dimText(2.0 + i * 0.1)}>{w} WORKER</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── COMMUNICATIONS: message flow ───────────────────────────────────────── */
function CommunicationsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — COMMS FLOW" rev="REV 02 — APR 2026" sheet="SHT 01 / COM" />
      <GridRefs />

      {/* Channels column */}
      {[
        { y: 220, label: 'EMAIL' },
        { y: 320, label: 'SMS' },
        { y: 420, label: 'CHAT' },
        { y: 520, label: 'CALL' },
        { y: 620, label: 'BUILDER MSG' },
      ].map((ch, i) => (
        <g key={ch.label}>
          <rect x="100" y={ch.y} width="200" height="60" style={d(520, 0.5 + i * 0.1, 0.8)} />
          <text x="120" y={ch.y + 36} style={annoText(1.2 + i * 0.1)}>{ch.label}</text>
          {/* Connector */}
          <path d={`M 300 ${ch.y + 30} Q 500 ${ch.y + 30} 600 500`} style={d(400, 1.4 + i * 0.1, 0.6)} />
        </g>
      ))}

      {/* Central router */}
      <circle cx="700" cy="500" r="100" style={d(628, 0.8, 1.4)} />
      <circle cx="700" cy="500" r="70" style={d(440, 1.0, 0.6)} />
      <text x="700" y="490" textAnchor="middle" style={annoText(2.0)}>COMMS</text>
      <text x="700" y="510" textAnchor="middle" style={annoText(2.1)}>ROUTER</text>
      {pulseDot(700, 500, 2.6, 4)}

      {/* Output: inbox → thread → reply */}
      <path d="M 800 500 L 960 500" style={d(160, 2.2, 0.8)} />
      <path d="M 956 495 L 964 500 L 956 505" style={d(20, 2.4, 0.8)} />

      {/* Thread view */}
      <rect x="980" y="280" width="520" height="440" style={d(1920, 1.2, 0.8)} />
      <text x="1000" y="310" style={annoText(1.8)}>THREAD #4421 — BROOKFIELD</text>
      <line x1="1000" y1="322" x2="1480" y2="322" style={d(480, 1.6, 0.5)} />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={1000 + (i % 2) * 20} y={340 + i * 70} width="440" height="54" style={d(988, 1.8 + i * 0.1, 0.5)} />
          <circle cx={1020 + (i % 2) * 20} cy={367 + i * 70} r="8" style={d(50, 2.0 + i * 0.1, 0.6)} />
          <text x={1040 + (i % 2) * 20} y={362 + i * 70} style={{ ...annoText(2.1 + i * 0.1), fontSize: '7px' }}>
            {i % 2 === 0 ? 'ABEL' : 'BWP'} · 2H AGO
          </text>
          <text x={1040 + (i % 2) * 20} y={382 + i * 70} style={dimText(2.2 + i * 0.1)}>____________________</text>
        </g>
      ))}

      {/* Typing indicator */}
      {pulseDot(1480, 367 + 4 * 70, 3.2, 3)}
      {pulseDot(1490, 367 + 4 * 70, 3.4, 3)}

      <Reduced />
    </svg>
  )
}

/* ── DOCUMENTS: stacked document icons ──────────────────────────────────── */
function DocumentsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — DOCUMENT VAULT" rev="REV 02 — APR 2026" sheet="SHT 01 / DOC" />
      <GridRefs />

      {/* Stacked doc cards */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={160 + i * 12} y={200 + i * 12} width="400" height="520" style={d(1840, 0.4 + i * 0.1, 0.8)} />
        </g>
      ))}
      {/* Top doc — detailed */}
      <rect x="196" y="236" width="400" height="520" style={d(1840, 0.8, 1.2)} />
      {/* Page fold corner */}
      <path d="M 566 236 L 596 266 L 566 266 Z" style={d(100, 1.0, 0.8)} />
      {/* Header band */}
      <rect x="220" y="280" width="360" height="60" style={d(840, 1.2, 0.7)} />
      <text x="240" y="320" style={annoText(1.6)}>CONTRACT — ABEL × BROOKFIELD</text>
      {/* Body lines */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <line
          key={i}
          x1="220"
          y1={380 + i * 30}
          x2={i === 8 ? 420 : 560}
          y2={380 + i * 30}
          style={d(i === 8 ? 200 : 340, 1.6 + i * 0.08, 0.4)}
        />
      ))}
      {/* Signature block */}
      <line x1="220" y1="700" x2="400" y2="700" style={d(180, 2.6, 0.6)} />
      <text x="220" y="718" style={dimText(2.8)}>SIGNATURE</text>
      <line x1="420" y1="700" x2="560" y2="700" style={d(140, 2.7, 0.6)} />
      <text x="420" y="718" style={dimText(2.9)}>DATE</text>

      {/* Doc type grid (right) */}
      <text x="760" y="228" style={annoText(1.2)}>DOCUMENT TYPES</text>
      {[
        { label: 'CONTRACTS', count: '124' },
        { label: 'INVOICES', count: '832' },
        { label: 'QUOTES', count: '261' },
        { label: 'SPECS', count: '96' },
        { label: 'DRAWINGS', count: '58' },
        { label: 'CERTS', count: '44' },
        { label: 'POLICIES', count: '22' },
        { label: 'CORRESP', count: '1,208' },
      ].map((t, i) => (
        <g key={t.label}>
          <rect x={760 + (i % 4) * 200} y={260 + Math.floor(i / 4) * 220} width="180" height="200" style={d(760, 0.6 + i * 0.1, 0.7)} />
          {/* Doc icon */}
          <rect x={776 + (i % 4) * 200} y={280 + Math.floor(i / 4) * 220} width="60" height="80" style={d(280, 0.8 + i * 0.1, 0.6)} />
          <line x1={782 + (i % 4) * 200} y1={300 + Math.floor(i / 4) * 220} x2={830 + (i % 4) * 200} y2={300 + Math.floor(i / 4) * 220} style={d(48, 1.0 + i * 0.1, 0.3)} />
          <line x1={782 + (i % 4) * 200} y1={316 + Math.floor(i / 4) * 220} x2={830 + (i % 4) * 200} y2={316 + Math.floor(i / 4) * 220} style={d(48, 1.1 + i * 0.1, 0.3)} />
          <line x1={782 + (i % 4) * 200} y1={332 + Math.floor(i / 4) * 220} x2={820 + (i % 4) * 200} y2={332 + Math.floor(i / 4) * 220} style={d(38, 1.2 + i * 0.1, 0.3)} />
          <text x={856 + (i % 4) * 200} y={310 + Math.floor(i / 4) * 220} style={annoText(1.4 + i * 0.1)}>{t.label}</text>
          <text x={856 + (i % 4) * 200} y={344 + Math.floor(i / 4) * 220} style={{ ...dimText(1.6 + i * 0.1), fontSize: '14px' }}>{t.count}</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── HR: org chart ──────────────────────────────────────────────────────── */
function HrBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — ORG CHART" rev="REV 05 — APR 2026" sheet="SHT 01 / HR" />
      <GridRefs />

      {/* Root: Nate */}
      <rect x="700" y="160" width="200" height="70" style={d(540, 0.4, 1.2)} />
      <text x="800" y="190" textAnchor="middle" style={annoText(0.9)}>NATE</text>
      <text x="800" y="210" textAnchor="middle" style={dimText(1.0)}>OWNER / GM</text>
      {pulseDot(800, 195, 1.2, 4)}

      {/* Level 2: Clint, Dawn, Dalton, Sean */}
      {[
        { x: 200, label: 'CLINT', role: 'COO' },
        { x: 540, label: 'DAWN', role: 'ACCOUNTING' },
        { x: 880, label: 'DALTON', role: 'BUS. DEV' },
        { x: 1220, label: 'SEAN', role: 'CX' },
      ].map((p, i) => (
        <g key={p.label}>
          <rect x={p.x} y="340" width="180" height="60" style={d(480, 0.8 + i * 0.1, 0.8)} />
          <text x={p.x + 90} y="366" textAnchor="middle" style={annoText(1.2 + i * 0.1)}>{p.label}</text>
          <text x={p.x + 90} y="386" textAnchor="middle" style={dimText(1.4 + i * 0.1)}>{p.role}</text>
          {/* Line from root */}
          <path d={`M 800 230 L 800 300 L ${p.x + 90} 300 L ${p.x + 90} 340`} style={d(200, 1.6 + i * 0.1, 0.5)} />
        </g>
      ))}

      {/* Level 3: PMs / Ops (simplified clusters) */}
      {[
        { x: 100, label: 'BRITTNEY', role: 'PM' },
        { x: 260, label: 'CHAD', role: 'PM' },
        { x: 420, label: 'JORDYN', role: 'LOG SUP' },
        { x: 580, label: 'LISA', role: 'EST' },
        { x: 740, label: 'THOMAS', role: 'PM' },
        { x: 900, label: 'BEN', role: 'PM' },
        { x: 1060, label: 'TIFFANY', role: 'PROD' },
        { x: 1220, label: 'GUNNER', role: 'PROD' },
        { x: 1380, label: '+ 10 MORE', role: 'CREW' },
      ].map((p, i) => (
        <g key={p.label}>
          <rect x={p.x} y="520" width="140" height="50" style={d(380, 1.4 + i * 0.06, 0.6)} />
          <text x={p.x + 70} y="542" textAnchor="middle" style={{ ...annoText(1.6 + i * 0.06), fontSize: '6px' }}>{p.label}</text>
          <text x={p.x + 70} y="558" textAnchor="middle" style={{ ...dimText(1.8 + i * 0.06), fontSize: '7px' }}>{p.role}</text>
        </g>
      ))}

      {/* Headcount metrics (bottom) */}
      {[
        { label: 'HEADCOUNT', val: '24' },
        { label: 'OPEN REQS', val: '2' },
        { label: 'RETENTION', val: '94%' },
        { label: 'NEW HIRES YTD', val: '3' },
      ].map((k, i) => (
        <g key={k.label}>
          <rect x={160 + i * 330} y="700" width="280" height="140" style={d(840, 2.0 + i * 0.12, 0.7)} />
          <text x={300 + i * 330} y="732" textAnchor="middle" style={annoText(2.4 + i * 0.1)}>{k.label}</text>
          <text x={300 + i * 330} y="800" textAnchor="middle" style={{ ...dimText(2.6 + i * 0.1), fontSize: '32px' }}>
            {k.val}
          </text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── INTEGRATIONS: API hub with spokes ──────────────────────────────────── */
function IntegrationsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — INTEGRATION HUB" rev="REV 03 — APR 2026" sheet="SHT 01 / INT" />
      <GridRefs />

      {/* Center hub */}
      <circle cx="800" cy="500" r="120" style={d(754, 0.4, 1.6)} />
      <circle cx="800" cy="500" r="90" style={d(565, 0.6, 0.6)} />
      <text x="800" y="490" textAnchor="middle" style={{ ...annoText(1.2), fontSize: '10px' }}>AEGIS</text>
      <text x="800" y="510" textAnchor="middle" style={annoText(1.3)}>ABEL OS</text>
      {pulseDot(800, 500, 1.6, 6)}

      {/* Connected services around the perimeter */}
      {[
        { name: 'QUICKBOOKS', angle: -135 },
        { name: 'BUILDERTREND', angle: -90 },
        { name: 'HYPHEN', angle: -45 },
        { name: 'GMAIL', angle: 0 },
        { name: 'GCAL', angle: 45 },
        { name: 'STYTCH', angle: 90 },
        { name: 'STRIPE', angle: 135 },
        { name: 'RESEND', angle: 180 },
      ].map((s, i) => {
        const rad = (s.angle * Math.PI) / 180
        const r = 380
        const x = 800 + Math.cos(rad) * r
        const y = 500 + Math.sin(rad) * r
        // Path from hub edge to box
        const startX = 800 + Math.cos(rad) * 120
        const startY = 500 + Math.sin(rad) * 120
        const endX = 800 + Math.cos(rad) * (r - 60)
        const endY = 500 + Math.sin(rad) * (r - 60)
        return (
          <g key={s.name}>
            <line x1={startX} y1={startY} x2={endX} y2={endY} style={d(Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2), 1.2 + i * 0.1, 0.6)} />
            <rect x={x - 60} y={y - 28} width="120" height="56" style={d(352, 1.6 + i * 0.1, 0.8)} />
            <text x={x} y={y} textAnchor="middle" style={{ ...annoText(2.0 + i * 0.1), fontSize: '7px' }}>{s.name}</text>
            <text x={x} y={y + 14} textAnchor="middle" style={{ ...dimText(2.2 + i * 0.1), fontSize: '7px' }}>OK</text>
            {pulseDot(x - 44, y, 2.5 + i * 0.1, 2)}
          </g>
        )
      })}

      {/* Sync health table (bottom) */}
      <text x="120" y="880" style={annoText(3.0)}>SYNC HEALTH — LAST 24H</text>
      <line x1="120" y1="892" x2="800" y2="892" style={d(680, 3.2, 0.5)} />
      <line x1="120" y1="940" x2="800" y2="940" style={d(680, 3.4, 0.3)} />

      <Reduced />
    </svg>
  )
}

/* ── REPORTING: dashboard wireframe ─────────────────────────────────────── */
function ReportingBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — REPORTS & ANALYTICS" rev="REV 04 — APR 2026" sheet="SHT 01 / RPT" />
      <GridRefs />

      {/* KPI row */}
      {[
        { label: 'REVENUE', val: '$—' },
        { label: 'ORDERS', val: '—' },
        { label: 'MARGIN', val: '—%' },
        { label: 'DSO', val: '—d' },
      ].map((k, i) => (
        <g key={k.label}>
          <rect x={120 + i * 360} y="180" width="320" height="120" style={d(880, 0.4 + i * 0.08, 0.8)} />
          <text x={140 + i * 360} y="212" style={annoText(0.9 + i * 0.08)}>{k.label}</text>
          <text x={140 + i * 360} y="268" style={{ ...dimText(1.1 + i * 0.08), fontSize: '32px' }}>{k.val}</text>
          {/* Sparkline */}
          <path d={`M ${300 + i * 360} 240 L ${320 + i * 360} 230 L ${340 + i * 360} 250 L ${360 + i * 360} 220 L ${380 + i * 360} 230 L ${420 + i * 360} 210`} style={d(160, 1.4 + i * 0.08, 1.0)} />
        </g>
      ))}

      {/* Big chart (left) */}
      <rect x="120" y="340" width="880" height="320" style={d(2400, 0.8, 0.8)} />
      <text x="140" y="372" style={annoText(1.4)}>REVENUE TREND — 12MO</text>
      {/* Gridlines */}
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1="160" y1={420 + i * 48} x2="980" y2={420 + i * 48} style={dd(820, 1.2 + i * 0.08, 0.3)} />
      ))}
      {/* Trend path */}
      <path d="M 160 580 L 240 560 L 320 540 L 400 520 L 480 500 L 560 460 L 640 480 L 720 440 L 800 420 L 880 400 L 960 380" style={d(820, 1.8, 1.6)} />
      {/* Area fill bars */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <rect key={i} x={180 + i * 80} y={640 - (20 + i * 5)} width="40" height={20 + i * 5} style={d((20 + i * 5) * 2 + 80, 2.2 + i * 0.08, 0.5)} />
      ))}

      {/* Right stack: pie + bars */}
      <rect x="1040" y="340" width="440" height="200" style={d(1360, 0.9, 0.8)} />
      <text x="1060" y="372" style={annoText(1.5)}>CHANNEL MIX</text>
      <circle cx="1140" cy="460" r="60" style={d(377, 1.4, 0.8)} />
      <path d="M 1140 460 L 1140 400 A 60 60 0 0 1 1192 490 Z" style={d(300, 1.8, 0.6)} />
      <path d="M 1140 460 L 1192 490 A 60 60 0 0 1 1100 510 Z" style={d(280, 2.0, 0.6)} />
      <text x="1240" y="430" style={annoText(2.2)}>BUILDERS 62%</text>
      <text x="1240" y="458" style={annoText(2.3)}>CUSTOM 24%</text>
      <text x="1240" y="486" style={annoText(2.4)}>RETAIL 14%</text>

      <rect x="1040" y="560" width="440" height="100" style={d(1080, 1.0, 0.8)} />
      <text x="1060" y="592" style={annoText(1.7)}>AR AGING</text>
      {[
        { w: 280, label: 'CURRENT' },
        { w: 80, label: '30D' },
        { w: 40, label: '60D+' },
      ].map((b, i) => (
        <g key={b.label}>
          <rect x={1060 + (i === 0 ? 0 : i === 1 ? 280 : 360)} y="608" width={b.w} height="28" style={d(b.w * 2 + 56, 2.0 + i * 0.1, 0.6)} />
          <text x={1060 + (i === 0 ? 0 : i === 1 ? 280 : 360) + b.w / 2} y="628" textAnchor="middle" style={{ ...annoText(2.4 + i * 0.1), fontSize: '7px' }}>{b.label}</text>
        </g>
      ))}

      {/* Table (bottom) */}
      <rect x="120" y="700" width="1360" height="200" style={d(3120, 1.2, 0.8)} />
      <line x1="120" y1="736" x2="1480" y2="736" style={d(1360, 1.4, 0.5)} />
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="120" y1={772 + i * 32} x2="1480" y2={772 + i * 32} style={d(1360, 1.6 + i * 0.08, 0.2)} />
      ))}
      <text x="140" y="724" style={annoText(1.6)}>TOP BUILDERS — YTD</text>

      <Reduced />
    </svg>
  )
}

/* ── ADMIN-BUILDERS: builder card grid ──────────────────────────────────── */
function AdminBuildersBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — BUILDER DIRECTORY" rev="REV 03 — APR 2026" sheet="SHT 01 / BLD" />
      <GridRefs />

      {/* Grid of builder cards */}
      {[0, 1, 2].map((row) => [0, 1, 2, 3].map((col) => {
        const i = row * 4 + col
        return (
          <g key={`${row}-${col}`}>
            <rect x={120 + col * 340} y={200 + row * 240} width="300" height="200" style={d(1000, 0.4 + i * 0.08, 0.8)} />
            {/* Avatar circle */}
            <circle cx={180 + col * 340} cy={260 + row * 240} r="30" style={d(188, 0.7 + i * 0.08, 1.0)} />
            <text x={180 + col * 340} y={268 + row * 240} textAnchor="middle" style={{ ...annoText(1.0 + i * 0.08), fontSize: '10px' }}>
              B{i + 1}
            </text>
            {/* Lines */}
            <line x1={220 + col * 340} y1={248 + row * 240} x2={400 + col * 340} y2={248 + row * 240} style={d(180, 1.2 + i * 0.08, 0.5)} />
            <line x1={220 + col * 340} y1={270 + row * 240} x2={360 + col * 340} y2={270 + row * 240} style={d(140, 1.4 + i * 0.08, 0.4)} />
            <line x1={140 + col * 340} y1={310 + row * 240} x2={400 + col * 340} y2={310 + row * 240} style={d(260, 1.6 + i * 0.08, 0.3)} />
            <line x1={140 + col * 340} y1={340 + row * 240} x2={400 + col * 340} y2={340 + row * 240} style={d(260, 1.7 + i * 0.08, 0.3)} />
            <line x1={140 + col * 340} y1={370 + row * 240} x2={340 + col * 340} y2={370 + row * 240} style={d(200, 1.8 + i * 0.08, 0.3)} />
            {/* Status chip */}
            <rect x={140 + col * 340} y={386 + row * 240} width="80" height="10" style={d(180, 1.9 + i * 0.08, 0.5)} />
          </g>
        )
      }))}

      {/* Filter bar */}
      <rect x="120" y="900" width="1360" height="40" style={d(2800, 2.4, 0.7)} />
      <text x="140" y="924" style={annoText(2.8)}>FILTER: ACTIVE · ALL REGIONS · 24 BUILDERS</text>

      <Reduced />
    </svg>
  )
}

/* ── ADMIN-PRODUCTS: product spec sheet ─────────────────────────────────── */
function AdminProductsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — PRODUCT SPEC" rev="REV 04 — APR 2026" sheet="SHT 01 / SKU" />
      <GridRefs />

      {/* Product drawing (left) — door elevation */}
      <rect x="140" y="180" width="360" height="640" style={d(2000, 0.4, 1.4)} />
      {/* Top rail */}
      <line x1="170" y1="220" x2="470" y2="220" style={d(300, 0.7, 0.6)} />
      {/* Stiles */}
      <line x1="170" y1="180" x2="170" y2="820" style={d(640, 0.8, 0.6)} />
      <line x1="470" y1="180" x2="470" y2="820" style={d(640, 0.9, 0.6)} />
      {/* Lock rail */}
      <line x1="170" y1="420" x2="470" y2="420" style={d(300, 1.0, 0.6)} />
      {/* Bottom rail */}
      <line x1="170" y1="780" x2="470" y2="780" style={d(300, 1.1, 0.6)} />
      {/* Panels */}
      {[{ x: 190, y: 240 }, { x: 330, y: 240 }, { x: 190, y: 440 }, { x: 330, y: 440 }, { x: 190, y: 600 }, { x: 330, y: 600 }].map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width="120" height="160" style={d(560, 1.2 + i * 0.1, 0.5)} />
      ))}
      {/* Dimensions */}
      <line x1="140" y1="850" x2="500" y2="850" style={d(360, 2.0, 0.5)} />
      <text x="320" y="866" textAnchor="middle" style={annoText(2.4)}>3'-0"</text>
      <line x1="540" y1="180" x2="540" y2="820" style={d(640, 2.1, 0.5)} />
      <text x="548" y="500" style={annoText(2.5)}>6'-8"</text>
      {/* Hardware bubble */}
      <circle cx="450" cy="500" r="20" style={d(126, 2.6, 0.8)} />
      <text x="450" y="504" textAnchor="middle" style={{ ...annoText(2.8), fontSize: '7px' }}>A</text>

      {/* Spec table (right) */}
      <rect x="640" y="180" width="840" height="640" style={d(2960, 0.8, 0.8)} />
      <text x="660" y="212" style={annoText(1.2)}>ED-4420 — 6-PANEL INTERIOR</text>
      <line x1="660" y1="224" x2="1460" y2="224" style={d(800, 1.4, 0.5)} />
      {[
        ['CORE', 'SOLID — POLY-FLAKE'],
        ['SKIN', '1/8" HDF — SMOOTH'],
        ['STILES/RAILS', 'ENG LVL — 1-1/8"'],
        ['PANELS', '6 PANEL — RAISED'],
        ['OVERALL', '36" × 80" × 1-3/4"'],
        ['HANDING', 'L / R'],
        ['JAMB', 'PRIMED MDF — 4-9/16"'],
        ['HINGE', '3.5" × 3 — BRUSHED NI'],
        ['BORE', '2-1/8" × 1"'],
        ['STD', 'ANSI A115.2'],
        ['LEAD TIME', '5 BUS DAYS'],
        ['COST', '$___'],
        ['LIST', '$___'],
        ['MARGIN', '—%'],
      ].map(([k, v], i) => (
        <g key={k}>
          <line x1="660" y1={254 + i * 38} x2="1460" y2={254 + i * 38} style={d(800, 1.8 + i * 0.06, 0.2)} />
          <text x="680" y={276 + i * 38} style={annoText(2.0 + i * 0.06)}>{k}</text>
          <text x="900" y={276 + i * 38} style={dimText(2.1 + i * 0.06)}>{v}</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── ADMIN-MONITORING: waveform / pulse ─────────────────────────────────── */
function AdminMonitoringBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — SYSTEM HEALTH" rev="REV 02 — APR 2026" sheet="SHT 01 / MON" />
      <GridRefs />

      {/* EKG / waveform (center) */}
      <rect x="120" y="220" width="1360" height="280" style={d(3280, 0.4, 0.8)} />
      <text x="140" y="250" style={annoText(1.2)}>LIVE EVENT STREAM</text>
      <line x1="140" y1="262" x2="1460" y2="262" style={d(1320, 1.4, 0.5)} />
      {/* Waveform path — mimics EKG */}
      {(() => {
        // Build a pseudo-ekg path
        let path = 'M 140 400'
        const step = 40
        for (let i = 0; i < 33; i++) {
          const x = 140 + i * step
          if (i % 8 === 2) {
            path += ` L ${x} 400 L ${x + 6} 330 L ${x + 12} 460 L ${x + 18} 360 L ${x + 24} 400`
          } else {
            path += ` L ${x + 20} 400`
          }
        }
        return <path d={path} style={d(2400, 1.8, 1.6)} />
      })()}
      {/* Gridlines */}
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="140" y1={300 + i * 60} x2="1460" y2={300 + i * 60} style={dd(1320, 1.2 + i * 0.08, 0.25)} />
      ))}

      {/* Service status grid */}
      {[
        'DATABASE', 'REDIS', 'QUEUE', 'WEBHOOKS',
        'CRON', 'AUTH', 'EMAIL', 'AI-API',
        'STORAGE', 'LOGS', 'METRICS', 'ALERTS',
      ].map((svc, i) => (
        <g key={svc}>
          <rect x={120 + (i % 6) * 230} y={560 + Math.floor(i / 6) * 140} width="210" height="120" style={d(660, 0.8 + i * 0.06, 0.7)} />
          <text x={140 + (i % 6) * 230} y={592 + Math.floor(i / 6) * 140} style={annoText(1.2 + i * 0.06)}>{svc}</text>
          <text x={140 + (i % 6) * 230} y={620 + Math.floor(i / 6) * 140} style={{ ...annoText(1.4 + i * 0.06), fontSize: '6px' }}>STATUS</text>
          <text x={140 + (i % 6) * 230} y={660 + Math.floor(i / 6) * 140} style={{ ...dimText(1.6 + i * 0.06), fontSize: '16px' }}>OK</text>
          {pulseDot(300 + (i % 6) * 230, 588 + Math.floor(i / 6) * 140, 1.8 + i * 0.08, 3)}
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── BUILDER-ORDERS: order card flow ────────────────────────────────────── */
function BuilderOrdersBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="MY ORDERS — BUILDER" rev="REV 03 — APR 2026" sheet="SHT 01 / ORD" />
      <GridRefs />

      {/* Order cards stack */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x="120" y={200 + i * 130} width="1360" height="100" style={d(2920, 0.4 + i * 0.12, 0.8)} />
          {/* Status indicator */}
          <rect x="120" y={200 + i * 130} width="8" height="100" style={d(216, 0.6 + i * 0.12, 0.8)} />
          {/* Order number */}
          <text x="160" y={232 + i * 130} style={annoText(1.0 + i * 0.12)}>ORD-{44210 + i}</text>
          <text x="160" y={260 + i * 130} style={{ ...dimText(1.2 + i * 0.12), fontSize: '11px' }}>COMMUNITY {String.fromCharCode(65 + i)} · LOT {i + 100}</text>
          <text x="160" y={284 + i * 130} style={{ ...dimText(1.3 + i * 0.12), fontSize: '8px' }}>24 ITEMS · $___,___</text>
          {/* Stage progress bar */}
          <line x1="500" y1={250 + i * 130} x2="1100" y2={250 + i * 130} style={d(600, 1.4 + i * 0.12, 0.5)} />
          {[0, 1, 2, 3, 4].map((s) => (
            <circle
              key={s}
              cx={500 + s * 150}
              cy={250 + i * 130}
              r={s <= i ? 8 : 6}
              style={d(s <= i ? 50 : 38, 1.6 + i * 0.12 + s * 0.05, s <= i ? 1.2 : 0.6)}
            />
          ))}
          <text x="500" y={280 + i * 130} style={{ ...dimText(1.8 + i * 0.12), fontSize: '6px' }}>QUOTED</text>
          <text x="648" y={280 + i * 130} style={{ ...dimText(1.85 + i * 0.12), fontSize: '6px' }}>CONFIRMED</text>
          <text x="798" y={280 + i * 130} style={{ ...dimText(1.9 + i * 0.12), fontSize: '6px' }}>BUILDING</text>
          <text x="948" y={280 + i * 130} style={{ ...dimText(1.95 + i * 0.12), fontSize: '6px' }}>STAGED</text>
          <text x="1078" y={280 + i * 130} style={{ ...dimText(2.0 + i * 0.12), fontSize: '6px' }}>DELIVERED</text>
          {/* Arrow */}
          <path d={`M 1400 ${248 + i * 130} L 1440 ${248 + i * 130} M 1430 ${242 + i * 130} L 1440 ${248 + i * 130} L 1430 ${254 + i * 130}`} style={d(70, 2.2 + i * 0.1, 0.6)} />
          {pulseDot(500 + (i < 5 ? i : 4) * 150, 250 + i * 130, 2.4 + i * 0.08, 4)}
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── BUILDER-PROJECTS: job timeline strip ───────────────────────────────── */
function BuilderProjectsBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="MY PROJECTS — BUILDER" rev="REV 02 — APR 2026" sheet="SHT 01 / PRJ" />
      <GridRefs />

      {/* Community grid */}
      {[0, 1, 2].map((row) => [0, 1, 2].map((col) => {
        const i = row * 3 + col
        return (
          <g key={`${row}-${col}`}>
            <rect x={140 + col * 440} y={200 + row * 240} width="400" height="200" style={d(1200, 0.4 + i * 0.1, 0.8)} />
            {/* Lot sketch */}
            <rect x={160 + col * 440} y={220 + row * 240} width="120" height="160" style={d(560, 0.7 + i * 0.1, 0.6)} />
            <rect x={180 + col * 440} y={260 + row * 240} width="80" height="100" style={d(360, 0.9 + i * 0.1, 0.5)} />
            {/* House outline */}
            <path d={`M ${180 + col * 440} ${260 + row * 240} L ${220 + col * 440} ${240 + row * 240} L ${260 + col * 440} ${260 + row * 240}`} style={d(80, 1.1 + i * 0.1, 0.6)} />
            {/* Info */}
            <text x={300 + col * 440} y={236 + row * 240} style={annoText(1.2 + i * 0.1)}>COMMUNITY {String.fromCharCode(65 + i)}</text>
            <text x={300 + col * 440} y={260 + row * 240} style={dimText(1.4 + i * 0.1)}>LOT {i + 100}</text>
            <line x1={300 + col * 440} y1={274 + row * 240} x2={520 + col * 440} y2={274 + row * 240} style={d(220, 1.5 + i * 0.1, 0.3)} />
            <text x={300 + col * 440} y={298 + row * 240} style={dimText(1.6 + i * 0.1)}>PLAN 2407-C</text>
            <text x={300 + col * 440} y={322 + row * 240} style={dimText(1.7 + i * 0.1)}>START: __/__/__</text>
            <text x={300 + col * 440} y={346 + row * 240} style={dimText(1.8 + i * 0.1)}>SHIP BY: __/__/__</text>
            <text x={300 + col * 440} y={370 + row * 240} style={dimText(1.9 + i * 0.1)}>STAGE: ——</text>
          </g>
        )
      }))}

      {/* Timeline strip (bottom) */}
      <rect x="120" y="840" width="1360" height="100" style={d(2920, 2.0, 0.8)} />
      <line x1="140" y1="880" x2="1460" y2="880" style={d(1320, 2.2, 0.7)} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
        <g key={i}>
          <line x1={160 + i * 108} y1="875" x2={160 + i * 108} y2="885" style={d(10, 2.4 + i * 0.04, 0.5)} />
          <text x={160 + i * 108} y="904" textAnchor="middle" style={{ ...annoText(2.6 + i * 0.04), fontSize: '6px' }}>
            {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][i]}
          </text>
        </g>
      ))}
      {pulseDot(448, 880, 3.6, 5)}

      <Reduced />
    </svg>
  )
}

/* ── BUILDER-FINANCE: invoice summary ───────────────────────────────────── */
function BuilderFinanceBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="MY ACCOUNT — BILLING" rev="REV 02 — APR 2026" sheet="SHT 01 / BIL" />
      <GridRefs />

      {/* Summary cards */}
      {[
        { label: 'BALANCE', val: '$—' },
        { label: 'OPEN INV', val: '—' },
        { label: 'AVG DSO', val: '—d' },
        { label: 'YTD SPEND', val: '$—' },
      ].map((k, i) => (
        <g key={k.label}>
          <rect x={120 + i * 340} y="180" width="300" height="140" style={d(880, 0.4 + i * 0.1, 0.8)} />
          <text x={140 + i * 340} y="212" style={annoText(0.9 + i * 0.1)}>{k.label}</text>
          <text x={140 + i * 340} y="290" style={{ ...dimText(1.1 + i * 0.1), fontSize: '30px' }}>{k.val}</text>
        </g>
      ))}

      {/* Invoice list */}
      <rect x="120" y="360" width="1360" height="460" style={d(3640, 0.8, 0.8)} />
      <line x1="120" y1="400" x2="1480" y2="400" style={d(1360, 1.0, 0.5)} />
      <text x="140" y="388" style={annoText(1.2)}>INV #</text>
      <text x="280" y="388" style={annoText(1.3)}>DATE</text>
      <text x="440" y="388" style={annoText(1.4)}>PO REF</text>
      <text x="720" y="388" style={annoText(1.5)}>AMOUNT</text>
      <text x="900" y="388" style={annoText(1.6)}>DUE</text>
      <text x="1080" y="388" style={annoText(1.7)}>STATUS</text>
      <text x="1280" y="388" style={annoText(1.8)}>ACTION</text>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <g key={i}>
          <line x1="120" y1={440 + i * 40} x2="1480" y2={440 + i * 40} style={d(1360, 1.2 + i * 0.08, 0.2)} />
          <text x="140" y={428 + i * 40} style={dimText(1.4 + i * 0.08)}>INV-____{i}</text>
          <text x="280" y={428 + i * 40} style={dimText(1.45 + i * 0.08)}>__/__/__</text>
          <text x="440" y={428 + i * 40} style={dimText(1.5 + i * 0.08)}>PO-____</text>
          <text x="720" y={428 + i * 40} style={dimText(1.55 + i * 0.08)}>$______</text>
          <text x="900" y={428 + i * 40} style={dimText(1.6 + i * 0.08)}>__d</text>
          {/* Status dot */}
          <circle cx="1094" cy={424 + i * 40} r="5" style={d(32, 1.7 + i * 0.08, 0.7)} />
          <text x="1108" y={428 + i * 40} style={{ ...dimText(1.75 + i * 0.08), fontSize: '8px' }}>OPEN</text>
          {/* Pay button */}
          <rect x="1280" y={414 + i * 40} width="80" height="20" style={d(200, 1.8 + i * 0.08, 0.6)} />
          <text x="1320" y={428 + i * 40} textAnchor="middle" style={{ ...annoText(1.9 + i * 0.08), fontSize: '7px' }}>PAY</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── BUILDER-ACCOUNT: profile card ──────────────────────────────────────── */
function BuilderAccountBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="MY ACCOUNT" rev="REV 02 — APR 2026" sheet="SHT 01 / ACC" />
      <GridRefs />

      {/* Profile card (center) */}
      <rect x="500" y="180" width="600" height="320" style={d(1840, 0.4, 1.0)} />
      {/* Avatar */}
      <circle cx="800" cy="280" r="60" style={d(377, 0.7, 1.2)} />
      <text x="800" y="290" textAnchor="middle" style={{ ...annoText(1.0), fontSize: '18px' }}>B</text>
      <text x="800" y="380" textAnchor="middle" style={annoText(1.4)}>BUILDER ACCOUNT</text>
      <line x1="560" y1="400" x2="1040" y2="400" style={d(480, 1.6, 0.5)} />
      <text x="800" y="430" textAnchor="middle" style={dimText(1.8)}>_______________________</text>
      <text x="800" y="460" textAnchor="middle" style={dimText(1.9)}>_____________</text>
      <text x="800" y="490" textAnchor="middle" style={dimText(2.0)}>____________</text>

      {/* Setting sections */}
      {[
        'CONTACT INFO',
        'BILLING ADDRESS',
        'SHIP-TO ADDRESSES',
        'USERS & ACCESS',
        'NOTIFICATIONS',
        'INTEGRATIONS',
      ].map((s, i) => (
        <g key={s}>
          <rect x={120 + (i % 3) * 500} y={540 + Math.floor(i / 3) * 180} width="460" height="140" style={d(1200, 0.8 + i * 0.1, 0.8)} />
          <text x={140 + (i % 3) * 500} y={572 + Math.floor(i / 3) * 180} style={annoText(1.2 + i * 0.1)}>{s}</text>
          <line x1={140 + (i % 3) * 500} y1={584 + Math.floor(i / 3) * 180} x2={560 + (i % 3) * 500} y2={584 + Math.floor(i / 3) * 180} style={d(420, 1.4 + i * 0.1, 0.4)} />
          {/* Rows */}
          <line x1={140 + (i % 3) * 500} y1={612 + Math.floor(i / 3) * 180} x2={520 + (i % 3) * 500} y2={612 + Math.floor(i / 3) * 180} style={d(380, 1.6 + i * 0.1, 0.3)} />
          <line x1={140 + (i % 3) * 500} y1={638 + Math.floor(i / 3) * 180} x2={480 + (i % 3) * 500} y2={638 + Math.floor(i / 3) * 180} style={d(340, 1.7 + i * 0.1, 0.3)} />
          <line x1={140 + (i % 3) * 500} y1={664 + Math.floor(i / 3) * 180} x2={440 + (i % 3) * 500} y2={664 + Math.floor(i / 3) * 180} style={d(300, 1.8 + i * 0.1, 0.3)} />
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── CREW: tool belt ────────────────────────────────────────────────────── */
function CrewBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — FIELD CREW" rev="REV 02 — APR 2026" sheet="SHT 01 / CRW" />
      <GridRefs />

      {/* Belt strap */}
      <path d="M 120 460 Q 800 580 1480 460" style={d(1360, 0.4, 1.8)} />
      <path d="M 120 500 Q 800 620 1480 500" style={d(1360, 0.6, 1.8)} />
      {/* Buckle */}
      <rect x="760" y="500" width="80" height="80" style={d(320, 1.0, 1.2)} />
      <rect x="780" y="520" width="40" height="40" style={d(160, 1.2, 0.8)} />

      {/* Tool pockets */}
      {[
        { x: 200, y: 580, w: 180, h: 240, label: 'HAMMER' },
        { x: 400, y: 600, w: 160, h: 220, label: 'TAPE' },
        { x: 580, y: 580, w: 180, h: 240, label: 'LEVEL' },
        { x: 860, y: 580, w: 140, h: 240, label: 'DRILL' },
        { x: 1020, y: 600, w: 160, h: 220, label: 'BITS' },
        { x: 1200, y: 580, w: 180, h: 240, label: 'FASTENERS' },
      ].map((p, i) => (
        <g key={p.label}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} style={d((p.w + p.h) * 2, 0.8 + i * 0.12, 1.0)} />
          <text x={p.x + p.w / 2} y={p.y + p.h + 20} textAnchor="middle" style={annoText(1.6 + i * 0.12)}>{p.label}</text>
          {/* Stitching dashed line */}
          <line x1={p.x + 10} y1={p.y + 10} x2={p.x + p.w - 10} y2={p.y + 10} style={dd(p.w - 20, 1.2 + i * 0.1, 0.4)} />
          <line x1={p.x + 10} y1={p.y + p.h - 10} x2={p.x + p.w - 10} y2={p.y + p.h - 10} style={dd(p.w - 20, 1.3 + i * 0.1, 0.4)} />
        </g>
      ))}

      {/* Today count / schedule (top) */}
      <rect x="120" y="180" width="500" height="220" style={d(1440, 0.4, 0.8)} />
      <text x="140" y="210" style={annoText(1.2)}>TODAY — 4 STOPS</text>
      <line x1="140" y1="222" x2="600" y2="222" style={d(460, 1.4, 0.5)} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="160" cy={254 + i * 36} r="10" style={d(63, 1.6 + i * 0.08, 0.8)} />
          <text x="160" y={258 + i * 36} textAnchor="middle" style={{ ...annoText(1.8 + i * 0.08), fontSize: '7px' }}>{i + 1}</text>
          <text x="184" y={258 + i * 36} style={dimText(2.0 + i * 0.08)}>STOP {i + 1} · __:__ AM</text>
          <text x="184" y={276 + i * 36} style={{ ...dimText(2.1 + i * 0.08), fontSize: '8px' }}>________________</text>
        </g>
      ))}

      <Reduced />
    </svg>
  )
}

/* ── DEFAULT: minimal dimension marks ───────────────────────────────────── */
function DefaultBG() {
  return (
    <svg viewBox="0 0 1600 1000" className="w-full h-full pagebg-element">
      <Frame title="ABEL — AEGIS PLATFORM" rev="REV 2026" sheet="SHT 01 / GEN" />
      <GridRefs />

      {/* Centered brand mark */}
      <rect x="600" y="400" width="400" height="200" style={d(1200, 0.4, 1.4)} />
      <line x1="600" y1="460" x2="1000" y2="460" style={d(400, 0.8, 0.6)} />
      <text x="800" y="448" textAnchor="middle" style={{ ...annoText(1.2), fontSize: '10px' }}>AEGIS · ABEL OS</text>
      <text x="800" y="520" textAnchor="middle" style={{ ...dimText(1.6), fontSize: '24px' }}>ABEL LUMBER</text>
      <text x="800" y="560" textAnchor="middle" style={annoText(2.0)}>DFW · EST. 2016</text>

      {/* Dimension lines */}
      <line x1="600" y1="650" x2="1000" y2="650" style={d(400, 2.2, 0.5)} />
      <text x="800" y="668" textAnchor="middle" style={annoText(2.6)}>CORE SYSTEM</text>

      {pulseDot(800, 500, 3.0, 5)}

      <Reduced />
    </svg>
  )
}

// ── prefers-reduced-motion wrapper (scoped) ───────────────────────────────
function Reduced() {
  return (
    <style>{`
      @media (prefers-reduced-motion: reduce) {
        .pagebg-element * {
          animation: none !important;
          stroke-dashoffset: 0 !important;
          opacity: 1 !important;
        }
      }
    `}</style>
  )
}

// ── Section → component map ───────────────────────────────────────────────
const SECTION_MAP: Record<PageSection, ComponentType> = {
  manufacturing: ManufacturingBG,
  delivery: DeliveryBG,
  warehouse: WarehouseBG,
  finance: FinanceBG,
  purchasing: PurchasingBG,
  sales: SalesBG,
  jobs: JobsBG,
  quality: QualityBG,
  ai: AiBG,
  communications: CommunicationsBG,
  documents: DocumentsBG,
  hr: HrBG,
  integrations: IntegrationsBG,
  reporting: ReportingBG,
  'admin-builders': AdminBuildersBG,
  'admin-products': AdminProductsBG,
  'admin-monitoring': AdminMonitoringBG,
  'builder-orders': BuilderOrdersBG,
  'builder-projects': BuilderProjectsBG,
  'builder-finance': BuilderFinanceBG,
  'builder-account': BuilderAccountBG,
  crew: CrewBG,
  default: DefaultBG,
}

// ── Main component ────────────────────────────────────────────────────────
function PageBackgroundImpl({ section, className = '' }: PageBackgroundProps) {
  const SectionSVG = SECTION_MAP[section] || DefaultBG

  return (
    <div
      className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ zIndex: 0, opacity: 0.15 }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 flex items-start justify-center pt-12"
        style={{ color: 'var(--fg)' }}
      >
        <div className="w-[94vw] max-w-[1800px] h-[min(1100px,95vh)]">
          <SectionSVG />
        </div>
      </div>
    </div>
  )
}

export default memo(PageBackgroundImpl)
export { PageBackgroundImpl as PageBackground }
export type { PageBackgroundProps }

{ PageBackgroundProps }
