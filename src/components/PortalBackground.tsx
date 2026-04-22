'use client'

/**
 * PortalBackground — unique animated SVG blueprint per portal type.
 *
 * v2: Richer architectural detail, dimension callouts with measurements,
 * cross-hatching, annotation bubbles, thicker strokes, and 12% opacity
 * so the backgrounds are VISIBLE — not invisible atmospheric mush.
 *
 * Inspired by architectural blueprint / technical drawing aesthetic.
 * Every line draws in with stroke-dashoffset animation.
 */

import { memo } from 'react'

export type PortalType = 'ops' | 'sales' | 'dashboard' | 'homeowner' | 'admin'

interface PortalBackgroundProps {
  portal: PortalType
  className?: string
}

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

// Dashed variant
const dd = (length: number, delay: number = 0, width: number = 0.8) => ({
  ...d(length, delay, width),
  strokeDasharray: '6,4',
})

// Dimension text style
const dimText = (delay: number = 0) => ({
  fill: 'currentColor',
  fontFamily: "'Azeret Mono', monospace",
  fontSize: '9px',
  letterSpacing: '0.08em',
  opacity: 0,
  animation: `bp-fade 1.5s ease ${delay}s forwards`,
})

// Annotation text (larger)
const annoText = (delay: number = 0) => ({
  ...dimText(delay),
  fontSize: '7px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.15em',
})

// Float animation
const floatStyle = (delay: number = 0) => ({
  animation: `orb-float 20s ease-in-out ${delay}s infinite`,
})

// Pulse dot
const pulseDot = (cx: number, cy: number, color: string, delay: number) => (
  <circle
    key={`p-${cx}-${cy}`}
    cx={cx} cy={cy} r="3"
    style={{
      fill: color,
      opacity: 0.5,
      animation: `bp-pulse 3s ease-in-out ${delay}s infinite`,
    }}
  />
)

/* ── OPS: Workflow / process engineering schematic ─────────────────── */
function OpsBackground() {
  return (
    <svg viewBox="0 0 1000 700" className="w-full h-full portal-bg-element">
      {/* Title block — top right corner */}
      <rect x="750" y="20" width="230" height="80" rx="0" style={d(620, 0, 0.8)} />
      <line x1="750" y1="50" x2="980" y2="50" style={d(230, 0.3, 0.6)} />
      <line x1="750" y1="70" x2="980" y2="70" style={d(230, 0.4, 0.6)} />
      <text x="765" y="42" style={annoText(1.5)}>ABEL LUMBER — OPS WORKFLOW</text>
      <text x="765" y="63" style={dimText(1.8)}>REV 03 — APRIL 2026</text>
      <text x="765" y="83" style={dimText(2.0)}>SHEET 1 OF 1</text>

      {/* Border frame with corner marks */}
      <rect x="15" y="15" width="970" height="670" rx="0" style={d(3280, 0, 0.4)} />
      {/* Corner registration marks */}
      <line x1="5" y1="15" x2="15" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="15" y1="5" x2="15" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="985" y1="5" x2="985" y2="15" style={d(10, 0.1, 0.6)} />
      <line x1="985" y1="15" x2="995" y2="15" style={d(10, 0.1, 0.6)} />

      {/* ── Main flow: RECEIVE → SCHEDULE → STAGE → DELIVER → CLOSE ── */}
      {/* Node 1: Receive */}
      <rect x="60" y="160" width="140" height="60" rx="4" style={d(400, 0.5, 1.5)} />
      <text x="95" y="195" style={dimText(1.5)}>RECEIVE ORDER</text>

      {/* Arrow 1→2 */}
      <line x1="200" y1="190" x2="280" y2="190" style={d(80, 1.0)} />
      <polyline points="270,183 280,190 270,197" style={d(20, 1.1, 1.2)} />

      {/* Node 2: Schedule */}
      <rect x="280" y="160" width="140" height="60" rx="4" style={d(400, 1.2, 1.5)} />
      <text x="305" y="195" style={dimText(2.0)}>SCHEDULE PM</text>

      {/* Arrow 2→3 */}
      <line x1="420" y1="190" x2="500" y2="190" style={d(80, 1.6)} />
      <polyline points="490,183 500,190 490,197" style={d(20, 1.7, 1.2)} />

      {/* Node 3: Decision diamond */}
      <polygon points="570,140 640,190 570,240 500,190" style={d(280, 1.8, 1.5)} />
      <text x="537" y="193" style={dimText(2.5)}>STOCK?</text>

      {/* Yes branch → Stage */}
      <line x1="640" y1="190" x2="720" y2="190" style={d(80, 2.2)} />
      <polyline points="710,183 720,190 710,197" style={d(20, 2.3, 1.2)} />
      <text x="660" y="182" style={annoText(2.8)}>YES</text>

      {/* Node 4: Stage */}
      <rect x="720" y="160" width="140" height="60" rx="4" style={d(400, 2.5, 1.5)} />
      <text x="745" y="195" style={dimText(3.0)}>STAGE MATERIAL</text>

      {/* No branch → down to PO */}
      <line x1="570" y1="240" x2="570" y2="320" style={d(80, 2.2)} />
      <polyline points="563,310 570,320 577,310" style={d(20, 2.3, 1.2)} />
      <text x="575" y="275" style={annoText(2.8)}>NO</text>

      {/* Node 5: PO */}
      <rect x="500" y="320" width="140" height="60" rx="4" style={d(400, 2.8, 1.5)} />
      <text x="530" y="355" style={dimText(3.2)}>CREATE PO</text>

      {/* PO → loops back up to Stage via right side */}
      <line x1="640" y1="350" x2="790" y2="350" style={dd(150, 3.2)} />
      <line x1="790" y1="350" x2="790" y2="220" style={dd(130, 3.4)} />
      <polyline points="783,230 790,220 797,230" style={d(20, 3.5, 1.2)} />

      {/* Stage → Deliver */}
      <line x1="790" y1="220" x2="790" y2="430" style={d(210, 3.0)} />
      <polyline points="783,420 790,430 797,420" style={d(20, 3.1, 1.2)} />

      {/* Node 6: Deliver */}
      <rect x="720" y="430" width="140" height="60" rx="4" style={d(400, 3.5, 1.5)} />
      <text x="756" y="465" style={dimText(4.0)}>DELIVER</text>

      {/* Deliver → Close */}
      <line x1="720" y1="460" x2="600" y2="460" style={d(120, 3.8)} />
      <polyline points="610,453 600,460 610,467" style={d(20, 3.9, 1.2)} />

      {/* Node 7: Close (rounded = terminal) */}
      <rect x="460" y="430" width="140" height="60" rx="30" style={d(400, 4.0, 1.5)} />
      <text x="496" y="465" style={dimText(4.5)}>CLOSE OUT</text>

      {/* ── Dimension lines ── */}
      {/* Horizontal distance: Receive to Stage */}
      <line x1="60" y1="130" x2="860" y2="130" style={dd(800, 4.2, 0.5)} />
      <line x1="60" y1="125" x2="60" y2="135" style={d(10, 4.2, 0.5)} />
      <line x1="860" y1="125" x2="860" y2="135" style={d(10, 4.2, 0.5)} />
      <text x="420" y="126" style={annoText(4.8)}>FULL CYCLE — 4.2 DAYS AVG</text>

      {/* ── Cross-hatch fill on decision diamond ── */}
      <clipPath id="ops-diamond-clip">
        <polygon points="570,142 638,190 570,238 502,190" />
      </clipPath>
      <g clipPath="url(#ops-diamond-clip)" style={{ opacity: 0.15 }}>
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`xh-${i}`}
            x1={502 + i * 12} y1="140" x2={502 + i * 12 - 30} y2="240"
            style={d(100, 2.0 + i * 0.05, 0.3)}
          />
        ))}
      </g>

      {/* Detail bubble — bottom left */}
      <circle cx="150" cy="520" r="50" style={d(314, 4.5, 0.6)} />
      <line x1="150" y1="470" x2="150" y2="520" style={d(50, 4.8, 0.4)} />
      <text x="118" y="525" style={annoText(5.0)}>DETAIL A</text>

      {/* Grid reference marks along bottom */}
      {['A','B','C','D','E','F','G','H'].map((letter, i) => (
        <g key={letter}>
          <line x1={60 + i * 120} y1="680" x2={60 + i * 120} y2="670" style={d(10, 0.2, 0.3)} />
          <text x={55 + i * 120} y="695" style={{...annoText(0.5 + i * 0.1), fontSize: '6px'}}>{letter}</text>
        </g>
      ))}

      {/* Pulse dots at active nodes */}
      {pulseDot(130, 190, 'var(--c1)', 0)}
      {pulseDot(350, 190, 'var(--c2)', -1)}
      {pulseDot(790, 460, 'var(--c3)', -2)}
    </svg>
  )
}

/* ── SALES: Pipeline funnel — technical cross-section ─────────────── */
function SalesBackground() {
  return (
    <svg viewBox="0 0 1000 700" className="w-full h-full portal-bg-element">
      {/* Title block */}
      <rect x="750" y="20" width="230" height="80" rx="0" style={d(620, 0, 0.8)} />
      <line x1="750" y1="50" x2="980" y2="50" style={d(230, 0.3, 0.6)} />
      <line x1="750" y1="70" x2="980" y2="70" style={d(230, 0.4, 0.6)} />
      <text x="765" y="42" style={annoText(1.5)}>ABEL LUMBER — SALES PIPELINE</text>
      <text x="765" y="63" style={dimText(1.8)}>FUNNEL ANALYSIS — Q2 2026</text>
      <text x="765" y="83" style={dimText(2.0)}>SHEET 1 OF 1</text>

      {/* Border */}
      <rect x="15" y="15" width="970" height="670" rx="0" style={d(3280, 0, 0.4)} />

      {/* ── Funnel — architectural cross-section style ── */}
      <path d="M250,100 L650,100 L550,320 L530,520 L370,520 L350,320 Z" style={d(1400, 0.5, 1.8)} />

      {/* Stage separators with labels */}
      <line x1="280" y1="165" x2="620" y2="165" style={d(340, 1.0, 0.8)} />
      <text x="660" y="140" style={dimText(2.0)}>PROSPECTS</text>
      <text x="660" y="152" style={annoText(2.2)}>TOP OF FUNNEL</text>

      <line x1="318" y1="235" x2="580" y2="235" style={d(262, 1.4, 0.8)} />
      <text x="620" y="210" style={dimText(2.4)}>QUALIFIED</text>
      <text x="620" y="222" style={annoText(2.6)}>NEEDS IDENTIFIED</text>

      <line x1="340" y1="310" x2="558" y2="310" style={d(218, 1.8, 0.8)} />
      <text x="600" y="285" style={dimText(2.8)}>PROPOSAL</text>
      <text x="600" y="297" style={annoText(3.0)}>PRICING SENT</text>

      <line x1="360" y1="400" x2="540" y2="400" style={d(180, 2.2, 0.8)} />
      <text x="580" y="375" style={dimText(3.2)}>NEGOTIATE</text>
      <text x="580" y="387" style={annoText(3.4)}>TERMS REVIEW</text>

      <text x="580" y="480" style={dimText(3.6)}>CLOSED WON</text>

      {/* Dimension lines — funnel width at top */}
      <line x1="250" y1="80" x2="650" y2="80" style={dd(400, 3.0, 0.5)} />
      <line x1="250" y1="75" x2="250" y2="85" style={d(10, 3.0, 0.5)} />
      <line x1="650" y1="75" x2="650" y2="85" style={d(10, 3.0, 0.5)} />
      <text x="410" y="76" style={annoText(3.5)}>100% — ALL LEADS</text>

      {/* Dimension lines — funnel width at bottom */}
      <line x1="370" y1="540" x2="530" y2="540" style={dd(160, 3.5, 0.5)} />
      <line x1="370" y1="535" x2="370" y2="545" style={d(10, 3.5, 0.5)} />
      <line x1="530" y1="535" x2="530" y2="545" style={d(10, 3.5, 0.5)} />
      <text x="410" y="556" style={annoText(4.0)}>12% — CLOSED</text>

      {/* Height dimension */}
      <line x1="210" y1="100" x2="210" y2="520" style={dd(420, 3.8, 0.5)} />
      <line x1="205" y1="100" x2="215" y2="100" style={d(10, 3.8, 0.5)} />
      <line x1="205" y1="520" x2="215" y2="520" style={d(10, 3.8, 0.5)} />
      <text x="192" y="320" style={annoText(4.2)} transform="rotate(-90,192,320)">42 DAY CYCLE</text>

      {/* Cross-hatch fill on funnel body */}
      <clipPath id="sales-funnel-clip">
        <path d="M252,102 L648,102 L548,318 L528,518 L372,518 L352,318 Z" />
      </clipPath>
      <g clipPath="url(#sales-funnel-clip)" style={{ opacity: 0.08 }}>
        {Array.from({ length: 25 }, (_, i) => (
          <line key={`fh-${i}`}
            x1={200 + i * 20} y1="90" x2={200 + i * 20 - 60} y2="530"
            style={d(440, 1.0 + i * 0.04, 0.3)}
          />
        ))}
      </g>

      {/* Deal circles trickling down */}
      {pulseDot(400, 130, 'var(--c1)', 0)}
      {pulseDot(500, 130, 'var(--c2)', -1)}
      {pulseDot(350, 130, 'var(--c3)', -2)}
      {pulseDot(450, 200, 'var(--c1)', -3)}
      {pulseDot(420, 270, 'var(--c2)', -4)}
      {pulseDot(460, 360, 'var(--c3)', -5)}
      {pulseDot(440, 480, 'var(--c4)', -6)}

      {/* Conversion arrows on right side */}
      {[{y: 140, pct: '65%'}, {y: 210, pct: '42%'}, {y: 285, pct: '28%'}, {y: 375, pct: '18%'}].map((item, i) => (
        <g key={`conv-${i}`}>
          <line x1="710" y1={item.y} x2="710" y2={item.y + 55} style={d(55, 2.5 + i * 0.3, 0.6)} />
          <polyline points={`705,${item.y + 45} 710,${item.y + 55} 715,${item.y + 45}`} style={d(14, 2.6 + i * 0.3, 0.8)} />
          <text x="720" y={item.y + 32} style={annoText(3.0 + i * 0.3)}>{item.pct}</text>
        </g>
      ))}

      {/* Grid refs along bottom */}
      {['A','B','C','D','E','F','G','H'].map((letter, i) => (
        <g key={letter}>
          <line x1={60 + i * 120} y1="680" x2={60 + i * 120} y2="670" style={d(10, 0.2, 0.3)} />
          <text x={55 + i * 120} y="695" style={{...annoText(0.5 + i * 0.1), fontSize: '6px'}}>{letter}</text>
        </g>
      ))}
    </svg>
  )
}

/* ── DASHBOARD: Door + frame — full architectural elevation ───────── */
function DashboardBackground() {
  return (
    <svg viewBox="0 0 1000 700" className="w-full h-full portal-bg-element">
      {/* Title block */}
      <rect x="750" y="20" width="230" height="80" rx="0" style={d(620, 0, 0.8)} />
      <line x1="750" y1="50" x2="980" y2="50" style={d(230, 0.3, 0.6)} />
      <line x1="750" y1="70" x2="980" y2="70" style={d(230, 0.4, 0.6)} />
      <text x="765" y="42" style={annoText(1.5)}>ABEL LUMBER — DOOR ELEVATION</text>
      <text x="765" y="63" style={dimText(1.8)}>6-PANEL ENTRY — DETAIL 01</text>
      <text x="765" y="83" style={dimText(2.0)}>SCALE: 1/4&quot; = 1&apos;-0&quot;</text>

      {/* Border */}
      <rect x="15" y="15" width="970" height="670" rx="0" style={d(3280, 0, 0.4)} />

      {/* ── Door frame — outer jamb ── */}
      <rect x="300" y="60" width="280" height="560" rx="0" style={d(1680, 0.3, 2)} />

      {/* Inner frame (reveal) */}
      <rect x="312" y="72" width="256" height="536" rx="0" style={d(1584, 0.6, 1.2)} />

      {/* ── 6-panel door ── */}
      {/* Top pair */}
      <rect x="330" y="90" width="100" height="130" rx="3" style={d(460, 1.0, 1)} />
      <rect x="450" y="90" width="100" height="130" rx="3" style={d(460, 1.2, 1)} />

      {/* Middle pair */}
      <rect x="330" y="240" width="100" height="100" rx="3" style={d(400, 1.5, 1)} />
      <rect x="450" y="240" width="100" height="100" rx="3" style={d(400, 1.7, 1)} />

      {/* Bottom pair */}
      <rect x="330" y="360" width="100" height="210" rx="3" style={d(620, 2.0, 1)} />
      <rect x="450" y="360" width="100" height="210" rx="3" style={d(620, 2.2, 1)} />

      {/* Panel cross-hatch (wood grain suggestion) */}
      <clipPath id="door-panel-1">
        <rect x="332" y="92" width="96" height="126" rx="2" />
      </clipPath>
      <g clipPath="url(#door-panel-1)" style={{ opacity: 0.06 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`g1-${i}`}
            x1={332 + i * 13} y1="92" x2={332 + i * 13 + 5} y2="218"
            style={d(130, 1.2 + i * 0.03, 0.3)}
          />
        ))}
      </g>

      {/* Stiles and rails */}
      <line x1="440" y1="72" x2="440" y2="608" style={d(536, 0.8, 0.6)} /> {/* center stile */}

      {/* Hardware — lever handle */}
      <circle cx="540" cy="380" r="12" style={d(75, 2.8, 1.2)} />
      <circle cx="540" cy="380" r="4" style={d(25, 3.0, 0.8)} />
      <rect x="536" y="350" width="8" height="18" rx="2" style={d(52, 3.2, 0.8)} /> {/* deadbolt */}

      {/* Hinges */}
      <rect x="314" y="130" width="10" height="22" rx="2" style={d(64, 2.5, 0.8)} />
      <rect x="314" y="320" width="10" height="22" rx="2" style={d(64, 2.7, 0.8)} />
      <rect x="314" y="510" width="10" height="22" rx="2" style={d(64, 2.9, 0.8)} />

      {/* Threshold */}
      <rect x="298" y="620" width="284" height="12" rx="1" style={d(592, 3.0, 0.8)} />
      {/* Threshold hatch */}
      <clipPath id="threshold-clip">
        <rect x="300" y="622" width="280" height="8" />
      </clipPath>
      <g clipPath="url(#threshold-clip)" style={{ opacity: 0.12 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <line key={`th-${i}`}
            x1={300 + i * 15} y1="622" x2={300 + i * 15 - 5} y2="630"
            style={d(10, 3.2 + i * 0.02, 0.3)}
          />
        ))}
      </g>

      {/* ── Dimension lines ── */}
      {/* Height — left side */}
      <line x1="260" y1="60" x2="260" y2="620" style={dd(560, 3.5, 0.6)} />
      <line x1="255" y1="60" x2="265" y2="60" style={d(10, 3.5, 0.6)} />
      <line x1="255" y1="620" x2="265" y2="620" style={d(10, 3.5, 0.6)} />
      <text x="235" y="345" style={annoText(4.2)} transform="rotate(-90,235,345)">6&apos;-8&quot;</text>

      {/* Width — top */}
      <line x1="300" y1="42" x2="580" y2="42" style={dd(280, 3.8, 0.6)} />
      <line x1="300" y1="37" x2="300" y2="47" style={d(10, 3.8, 0.6)} />
      <line x1="580" y1="37" x2="580" y2="47" style={d(10, 3.8, 0.6)} />
      <text x="410" y="38" style={annoText(4.5)}>2&apos;-10&quot;</text>

      {/* Panel height dimension */}
      <line x1="610" y1="90" x2="610" y2="220" style={dd(130, 4.0, 0.5)} />
      <line x1="605" y1="90" x2="615" y2="90" style={d(10, 4.0, 0.5)} />
      <line x1="605" y1="220" x2="615" y2="220" style={d(10, 4.0, 0.5)} />
      <text x="620" y="160" style={annoText(4.8)}>14&quot;</text>

      {/* ── Detail callout bubble — hardware ── */}
      <circle cx="680" cy="380" r="60" style={d(377, 4.5, 0.6)} />
      <line x1="552" y1="380" x2="620" y2="380" style={dd(68, 4.7, 0.5)} />
      <text x="660" y="375" style={annoText(5.2)}>DETAIL B</text>
      <text x="656" y="388" style={{...dimText(5.4), fontSize: '7px'}}>EMTEK LEVER</text>

      {/* ── Section cut marks — bottom ── */}
      <line x1="350" y1="650" x2="350" y2="665" style={d(15, 4.8, 1.2)} />
      <line x1="530" y1="650" x2="530" y2="665" style={d(15, 4.8, 1.2)} />
      <text x="420" y="660" style={annoText(5.0)}>SECTION A-A</text>
      <line x1="370" y1="658" x2="510" y2="658" style={d(140, 5.0, 0.8)} />
      <polyline points="375,654 370,658 375,662" style={d(12, 5.1, 0.8)} />
      <polyline points="505,654 510,658 505,662" style={d(12, 5.1, 0.8)} />

      {/* Grid refs */}
      {['1','2','3','4','5','6','7'].map((n, i) => (
        <g key={n}>
          <line x1={20} y1={60 + i * 95} x2={10} y2={60 + i * 95} style={d(10, 0.2, 0.3)} />
          <text x={6} y={64 + i * 95} style={{...annoText(0.5), fontSize: '6px', textAnchor: 'end'}}>{n}</text>
        </g>
      ))}

      {/* Subtle glow on handle */}
      {pulseDot(540, 380, 'var(--c1)', 0)}
    </svg>
  )
}

/* ── HOMEOWNER: House front elevation ─────────────────────────────── */
function HomeownerBackground() {
  return (
    <svg viewBox="0 0 1000 700" className="w-full h-full portal-bg-element">
      {/* Title block */}
      <rect x="750" y="20" width="230" height="80" rx="0" style={d(620, 0, 0.8)} />
      <line x1="750" y1="50" x2="980" y2="50" style={d(230, 0.3, 0.6)} />
      <line x1="750" y1="70" x2="980" y2="70" style={d(230, 0.4, 0.6)} />
      <text x="765" y="42" style={annoText(1.5)}>ABEL LUMBER — FRONT ELEVATION</text>
      <text x="765" y="63" style={dimText(1.8)}>HOMEOWNER PORTAL</text>
      <text x="765" y="83" style={dimText(2.0)}>SCALE: 1/8&quot; = 1&apos;-0&quot;</text>

      {/* Border */}
      <rect x="15" y="15" width="970" height="670" rx="0" style={d(3280, 0, 0.4)} />

      {/* Ground line */}
      <line x1="100" y1="560" x2="780" y2="560" style={d(680, 0.3, 1.2)} />

      {/* Foundation */}
      <rect x="180" y="540" width="520" height="20" rx="0" style={d(1080, 0.5, 0.8)} />
      {/* Foundation hatch */}
      <clipPath id="found-clip">
        <rect x="182" y="542" width="516" height="16" />
      </clipPath>
      <g clipPath="url(#found-clip)" style={{ opacity: 0.1 }}>
        {Array.from({ length: 35 }, (_, i) => (
          <line key={`fnd-${i}`}
            x1={182 + i * 15} y1="542" x2={182 + i * 15 - 8} y2="558"
            style={d(20, 0.8 + i * 0.02, 0.3)}
          />
        ))}
      </g>

      {/* House walls */}
      <rect x="200" y="260" width="480" height="280" rx="0" style={d(1520, 0.8, 1.8)} />

      {/* Roof — gable */}
      <path d="M160,265 L440,100 L720,265" style={d(800, 1.0, 2)} />
      {/* Roof overhang lines */}
      <line x1="160" y1="265" x2="200" y2="265" style={d(40, 1.2, 0.6)} />
      <line x1="680" y1="265" x2="720" y2="265" style={d(40, 1.2, 0.6)} />

      {/* Roof ridge line */}
      <line x1="440" y1="100" x2="440" y2="112" style={d(12, 1.5, 0.8)} />

      {/* ── Front door (THE hero — what Abel sells) ── */}
      <rect x="380" y="370" width="120" height="170" rx="2" style={d(580, 1.5, 2.2)} />
      {/* Door panels — 2 panel */}
      <rect x="395" y="385" width="90" height="60" rx="2" style={d(300, 2.0, 1)} />
      <rect x="395" y="460" width="90" height="65" rx="2" style={d(310, 2.2, 1)} />
      {/* Door handle */}
      <circle cx="485" cy="470" r="6" style={d(38, 2.5, 1)} />
      {/* Transom / sidelites */}
      <rect x="355" y="370" width="25" height="170" rx="0" style={d(390, 2.0, 0.8)} /> {/* left sidelite */}
      <rect x="500" y="370" width="25" height="170" rx="0" style={d(390, 2.0, 0.8)} /> {/* right sidelite */}
      {/* Sidelite panes */}
      <line x1="367" y1="430" x2="367" y2="540" style={dd(110, 2.5, 0.4)} />
      <line x1="512" y1="430" x2="512" y2="540" style={dd(110, 2.5, 0.4)} />

      {/* Step / stoop */}
      <rect x="340" y="540" width="200" height="20" rx="0" style={d(440, 2.8, 0.8)} />

      {/* Left window */}
      <rect x="230" y="320" width="90" height="80" rx="0" style={d(340, 2.0, 1.2)} />
      <line x1="275" y1="320" x2="275" y2="400" style={d(80, 2.3, 0.6)} />
      <line x1="230" y1="360" x2="320" y2="360" style={d(90, 2.4, 0.6)} />
      {/* Window sill */}
      <line x1="225" y1="400" x2="325" y2="400" style={d(100, 2.5, 1)} />

      {/* Right window */}
      <rect x="560" y="320" width="90" height="80" rx="0" style={d(340, 2.0, 1.2)} />
      <line x1="605" y1="320" x2="605" y2="400" style={d(80, 2.3, 0.6)} />
      <line x1="560" y1="360" x2="650" y2="360" style={d(90, 2.4, 0.6)} />
      <line x1="555" y1="400" x2="655" y2="400" style={d(100, 2.5, 1)} />

      {/* Garage (left) */}
      <rect x="200" y="430" width="130" height="110" rx="2" style={d(480, 2.5, 1.2)} />
      {/* Garage panel lines */}
      {[0,1,2,3].map(i => (
        <line key={`gar-${i}`}
          x1="205" y1={440 + i * 25} x2="325" y2={440 + i * 25}
          style={d(120, 2.8 + i * 0.1, 0.4)}
        />
      ))}

      {/* Chimney */}
      <rect x="560" y="140" width="45" height="125" rx="0" style={d(340, 3.0, 1)} />
      <rect x="555" y="135" width="55" height="10" rx="0" style={d(130, 3.2, 0.8)} /> {/* cap */}

      {/* ── Dimension lines ── */}
      {/* Overall width */}
      <line x1="200" y1="580" x2="680" y2="580" style={dd(480, 3.5, 0.5)} />
      <line x1="200" y1="575" x2="200" y2="585" style={d(10, 3.5, 0.5)} />
      <line x1="680" y1="575" x2="680" y2="585" style={d(10, 3.5, 0.5)} />
      <text x="410" y="594" style={annoText(4.2)}>42&apos;-0&quot;</text>

      {/* Ridge height */}
      <line x1="130" y1="100" x2="130" y2="560" style={dd(460, 3.8, 0.5)} />
      <line x1="125" y1="100" x2="135" y2="100" style={d(10, 3.8, 0.5)} />
      <line x1="125" y1="560" x2="135" y2="560" style={d(10, 3.8, 0.5)} />
      <text x="108" y="340" style={annoText(4.5)} transform="rotate(-90,108,340)">24&apos;-6&quot;</text>

      {/* Door height callout */}
      <line x1="540" y1="370" x2="540" y2="540" style={dd(170, 4.0, 0.4)} />
      <line x1="535" y1="370" x2="545" y2="370" style={d(10, 4.0, 0.4)} />
      <line x1="535" y1="540" x2="545" y2="540" style={d(10, 4.0, 0.4)} />
      <text x="548" y="460" style={annoText(4.5)}>6&apos;-8&quot;</text>

      {/* Detail callout — door */}
      <circle cx="820" cy="460" r="55" style={d(345, 4.5, 0.6)} />
      <line x1="525" y1="460" x2="765" y2="460" style={dd(240, 4.7, 0.4)} />
      <text x="798" y="455" style={annoText(5.0)}>DETAIL A</text>
      <text x="792" y="468" style={{...dimText(5.2), fontSize: '7px'}}>ENTRY DOOR</text>

      {/* Landscaping — circles for trees/shrubs */}
      <ellipse cx="150" cy="530" rx="40" ry="30" style={{...d(140, 4.0, 0.5), strokeDasharray: '4,3'}} />
      <ellipse cx="150" cy="530" rx="25" ry="18" style={{...d(90, 4.2, 0.4), strokeDasharray: '3,3'}} />
      <ellipse cx="750" cy="530" rx="35" ry="28" style={{...d(130, 4.0, 0.5), strokeDasharray: '4,3'}} />

      {pulseDot(440, 470, 'var(--c1)', 0)}
    </svg>
  )
}

/* ── ADMIN: System architecture / circuit + gears ─────────────────── */
function AdminBackground() {
  return (
    <svg viewBox="0 0 1000 700" className="w-full h-full portal-bg-element">
      {/* Title block */}
      <rect x="750" y="20" width="230" height="80" rx="0" style={d(620, 0, 0.8)} />
      <line x1="750" y1="50" x2="980" y2="50" style={d(230, 0.3, 0.6)} />
      <line x1="750" y1="70" x2="980" y2="70" style={d(230, 0.4, 0.6)} />
      <text x="765" y="42" style={annoText(1.5)}>ABEL LUMBER — SYSTEM SCHEMATIC</text>
      <text x="765" y="63" style={dimText(1.8)}>ADMIN ARCHITECTURE — V3</text>
      <text x="765" y="83" style={dimText(2.0)}>SHEET 1 OF 1</text>

      {/* Border */}
      <rect x="15" y="15" width="970" height="670" rx="0" style={d(3280, 0, 0.4)} />

      {/* ── Large gear ── */}
      <circle cx="250" cy="280" r="100" style={d(628, 0.3, 1.5)} />
      <circle cx="250" cy="280" r="75" style={d(471, 0.5, 0.8)} />
      <circle cx="250" cy="280" r="20" style={d(126, 0.7, 1)} />
      {/* Gear teeth */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * 30 * Math.PI) / 180
        const x1 = 250 + 98 * Math.cos(angle)
        const y1 = 280 + 98 * Math.sin(angle)
        const x2 = 250 + 115 * Math.cos(angle)
        const y2 = 280 + 115 * Math.sin(angle)
        return <line key={`gt-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} style={d(17, 0.8 + i * 0.05, 3)} />
      })}

      {/* ── Small gear (meshed) ── */}
      <circle cx="400" cy="370" r="60" style={d(377, 1.5, 1.2)} />
      <circle cx="400" cy="370" r="42" style={d(264, 1.7, 0.6)} />
      <circle cx="400" cy="370" r="12" style={d(75, 1.9, 0.8)} />
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * 45 * Math.PI) / 180
        const x1 = 400 + 58 * Math.cos(angle)
        const y1 = 370 + 58 * Math.sin(angle)
        const x2 = 400 + 72 * Math.cos(angle)
        const y2 = 370 + 72 * Math.sin(angle)
        return <line key={`gs-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} style={d(14, 1.8 + i * 0.05, 2.5)} />
      })}

      {/* Cross-hatch inside large gear */}
      <clipPath id="gear-clip">
        <circle cx="250" cy="280" r="73" />
      </clipPath>
      <g clipPath="url(#gear-clip)" style={{ opacity: 0.06 }}>
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`gh-${i}`}
            x1={177 + i * 13} y1="207" x2={177 + i * 13 + 8} y2="353"
            style={d(146, 0.8 + i * 0.03, 0.3)}
          />
        ))}
      </g>

      {/* ── Circuit board traces ── */}
      <path d="M400,310 L400,200 L550,200 L550,280" style={d(250, 2.5, 1)} />
      <path d="M460,370 L600,370 L600,280 L700,280" style={d(280, 2.8, 1)} />
      <path d="M250,180 L250,120 L500,120" style={d(310, 3.0, 1)} />
      <path d="M400,430 L400,500 L300,500 L300,560" style={d(260, 3.3, 1)} />
      <path d="M150,280 L80,280 L80,450 L200,450" style={d(310, 3.5, 1)} />
      <path d="M700,280 L700,180 L800,180" style={d(220, 3.8, 1)} />
      <path d="M550,200 L700,200 L700,120" style={d(230, 4.0, 0.8)} />

      {/* Circuit junction nodes */}
      {[
        [550, 280], [700, 280], [500, 120], [300, 560], [200, 450], [800, 180], [700, 120]
      ].map(([cx, cy], i) => (
        <g key={`node-${i}`}>
          <rect x={cx - 6} y={cy - 6} width={12} height={12} rx="2" style={d(48, 3.0 + i * 0.15, 0.8)} />
        </g>
      ))}

      {/* ── Server rack diagram — right side ── */}
      <rect x="780" y="250" width="150" height="220" rx="3" style={d(740, 3.5, 1.2)} />
      {/* Rack units */}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={`ru-${i}`}>
          <line x1="785" y1={262 + i * 26} x2="925" y2={262 + i * 26} style={d(140, 3.8 + i * 0.1, 0.4)} />
          <circle cx="795" cy={274 + i * 26} r="2" style={{fill: i < 5 ? 'var(--c2)' : 'var(--fg)', opacity: i < 5 ? 0.5 : 0.15}} />
        </g>
      ))}
      <text x="830" y="490" style={annoText(4.8)}>NUC CLUSTER</text>

      {/* ── Data flow pulses ── */}
      <circle cx="0" cy="0" r="3.5" style={{ fill: 'var(--c2)', opacity: 0.6 }}>
        <animateMotion dur="4s" repeatCount="indefinite" path="M400,310 L400,200 L550,200 L550,280" />
      </circle>
      <circle cx="0" cy="0" r="3.5" style={{ fill: 'var(--c3)', opacity: 0.6 }}>
        <animateMotion dur="5s" repeatCount="indefinite" path="M460,370 L600,370 L600,280 L700,280" />
      </circle>
      <circle cx="0" cy="0" r="3" style={{ fill: 'var(--c1)', opacity: 0.5 }}>
        <animateMotion dur="6s" repeatCount="indefinite" path="M250,180 L250,120 L500,120" />
      </circle>
      <circle cx="0" cy="0" r="3" style={{ fill: 'var(--c4)', opacity: 0.5 }}>
        <animateMotion dur="4.5s" repeatCount="indefinite" path="M700,280 L700,180 L800,180" />
      </circle>

      {/* Dimension: gear diameter */}
      <line x1="250" y1="400" x2="250" y2="420" style={d(20, 4.2, 0.5)} />
      <line x1="135" y1="415" x2="365" y2="415" style={dd(230, 4.3, 0.5)} />
      <text x="220" y="430" style={annoText(4.8)}>8&quot; DIA</text>

      {/* Connection label */}
      <text x="540" y="195" style={annoText(4.0)}>API BUS</text>
      <text x="80" y="275" style={annoText(4.2)}>REDIS</text>
      <text x="290" y="555" style={annoText(4.5)}>NEON DB</text>

      {pulseDot(250, 280, 'var(--c1)', 0)}
      {pulseDot(400, 370, 'var(--c2)', -2)}
      {pulseDot(855, 340, 'var(--c3)', -4)}
    </svg>
  )
}

/* ── Map portal type → component ────────────────────────────────────── */
const PORTAL_MAP: Record<PortalType, React.FC> = {
  ops: OpsBackground,
  sales: SalesBackground,
  dashboard: DashboardBackground,
  homeowner: HomeownerBackground,
  admin: AdminBackground,
}

function PortalBackgroundImpl({ portal, className = '' }: PortalBackgroundProps) {
  const PortalSVG = PORTAL_MAP[portal]
  if (!PortalSVG) return null

  return (
    <div
      className={`fixed inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ zIndex: 0, opacity: 0.12 }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--fg)' }}>
        <div className="w-[90vw] h-[85vh] max-w-[1400px] max-h-[900px]">
          <PortalSVG />
        </div>
      </div>
    </div>
  )
}

export default memo(PortalBackgroundImpl)
export { PortalBackgroundImpl as PortalBackground }
export type { PortalBackgroundProps }
